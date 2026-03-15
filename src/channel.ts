/**
 * PinsonBot Channel Plugin for OpenClaw
 *
 * Connects to PinsonBots Platform WebSocket and uses OpenClaw Gateway AI.
 *
 * Architecture:
 * - Runs inside OpenClaw Gateway as a Channel Plugin
 * - WebSocket client connects to PinsonBots Platform internal endpoint
 * - Inbound user messages are dispatched to Gateway AI
 * - AI responses are sent back to PinsonBots Platform
 *
 * WebSocket path: /pinsonbots/internal/plugin?token={internal_token}&lobster_id={lobster_id}
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import * as pluginSdk from "openclaw/plugin-sdk";
import {
  getConfig,
  isConfigured,
  listAccountIds,
  resolveAccount,
} from "./config.js";
import { PinsonBotConfigSchema } from "./config-schema.js";
import { isMessageProcessed, markMessageProcessed } from "./dedup.js";
import { PinsonBotWSClient } from "./ws-client.js";
import { getUpdater } from "./updater.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// 获取插件目录路径（自动查找 package.json）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 向上查找 package.json 所在的插件根目录
function findPluginRoot(startDir: string): string {
  const fs = require('fs');
  const path = require('path');
  
  let currentDir = startDir;
  // 最多向上查找 5 层
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(currentDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        // 确认是 pinsonbot-connector 的 package.json
        if (pkg.name === 'pinsonbot-connector') {
          return currentDir;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // 已到达根目录
    currentDir = parentDir;
  }
  // 找不到则返回默认值
  return path.join(__dirname, '..');
}

const PLUGIN_DIR = findPluginRoot(__dirname);
import type {
  PinsonBotChannelPlugin,
  PinsonBotInboundMessage,
  GatewayStartContext,
  GatewayStopResult,
  ResolvedAccount,
} from "./types.js";

// In-flight processing guard (memory-only, complementary to dedup)
const INFLIGHT_TTL_MS = 5 * 60 * 1000;
const processingDedupKeys = new Map<string, number>();

// Active client registry
const activeClients = new Map<string, PinsonBotWSClient>();

// Inbound counters for monitoring
const inboundCountersByAccount = new Map<
  string,
  {
    received: number;
    processed: number;
    dedupSkipped: number;
    inflightSkipped: number;
    failed: number;
  }
>();

// ============ Security Isolation ============

/**
 * 安全隔离配置
 * 
 * 管理员会话格式: pinsonbot:lobster_id:default 或 pinsonbot:default
 * 用户会话格式: pinsonbot:其他标识符
 */
interface SecurityConfig {
  adminSessionPatterns: RegExp[];  // 管理员会话匹配模式
  adminAgentId: string;            // 管理员使用的代理 ID
  userAgentId: string;             // 用户使用的代理 ID
}

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  adminSessionPatterns: [
    // 旧格式（向后兼容）
    /^pinsonbot:\d+:default$/,      // pinsonbot:8:default
    /^pinsonbot:default$/,          // pinsonbot:default
    /^pinsonbot:lobster_id:default$/, // pinsonbot:lobster_id:default
    // 新格式：pinsonbot:{lobster_id}:{user_role}:{user_id}
    /^pinsonbot:\d+:(owner|admin):\d+$/,  // pinsonbot:8:owner:123
    /^pinsonbot:\d+:(owner|admin):[^:]+$/,  // pinsonbot:8:owner:any_id
    // 群聊格式：pinsonbot:{lobster_id}:{user_role}:{user_id}:group:{group_id}:...
    /^pinsonbot:\d+:(owner|admin):\d+:group:/,  // pinsonbot:8:owner:123:group:1:user:123
    /^pinsonbot:\d+:(owner|admin):[^:]+:group:/,  // pinsonbot:8:owner:any_id:group:...
  ],
  adminAgentId: "admin",
  userAgentId: "user",
};

/**
 * 检查会话是否为管理员会话
 */
function isAdminSession(sessionKey: string, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): boolean {
  return config.adminSessionPatterns.some(pattern => pattern.test(sessionKey));
}

/**
 * 根据会话获取目标代理 ID
 */
function getTargetAgentId(sessionKey: string, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): string {
  return isAdminSession(sessionKey, config) ? config.adminAgentId : config.userAgentId;
}

/**
 * 获取会话角色描述
 */
function getSessionRole(sessionKey: string, config: SecurityConfig = DEFAULT_SECURITY_CONFIG): "admin" | "user" {
  return isAdminSession(sessionKey, config) ? "admin" : "user";
}

function getInboundCounters(accountId: string) {
  const existing = inboundCountersByAccount.get(accountId);
  if (existing) {
    return existing;
  }
  const created = {
    received: 0,
    processed: 0,
    dedupSkipped: 0,
    inflightSkipped: 0,
    failed: 0,
  };
  inboundCountersByAccount.set(accountId, created);
  return created;
}

// ============ Channel Plugin Definition ============

export const pinsonbotPlugin: PinsonBotChannelPlugin = {
  id: "pinsonbot",

  meta: {
    id: "pinsonbot",
    label: "PinsonBot",
    selectionLabel: "PinsonBot (微信机器人)",
    docsPath: "/channels/pinsonbot",
    blurb: "PinsonBots Platform 微信机器人通道，支持多账号管理。",
    aliases: ["pb", "pinson"],
  },

  configSchema: pluginSdk.buildChannelConfigSchema(PinsonBotConfigSchema),

  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false,
  },

  reload: { configPrefixes: ["channels.pinsonbot"] },

  // ============ Config Adapter ============

  config: {
    listAccountIds: (cfg: OpenClawConfig): string[] => listAccountIds(cfg),

    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveAccount(cfg, accountId),

    defaultAccountId: (): string => "default",

    isConfigured: (account: ResolvedAccount): boolean =>
      Boolean(
        account.config?.accounts &&
          Object.values(account.config.accounts).some(
            (acc: any) => acc.lobsterId && acc.internalToken
          )
      ),

    describeAccount: (account: ResolvedAccount) => ({
      accountId: account.accountId,
      name: account.name || "PinsonBot",
      enabled: account.enabled,
      configured: account.configured,
    }),
  },

  // ============ Security Adapter ============

  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: "open" as const,
      allowFrom: [],
      policyPath: "channels.pinsonbot.dmPolicy",
      allowFromPath: "channels.pinsonbot.allowFrom",
      approveHint: "使用 /allow pinsonbot:<userId> 批准用户",
      normalizeEntry: (raw: string) =>
        raw.replace(/^(pinsonbot|pb):/i, ""),
    }),
  },

  // ============ Groups Adapter ============

  groups: {
    resolveRequireMention: (): boolean => false,
    resolveGroupIntroHint: ({ groupId }: any): string | undefined =>
      groupId ? `PinsonBot sessionId=${groupId}` : undefined,
  },

  // ============ Messaging Adapter ============

  messaging: {
    normalizeTarget: (raw: string) =>
      raw ? raw.replace(/^(pinsonbot|pb):/i, "") : undefined,
    targetResolver: {
      looksLikeId: (id: string): boolean => /^[\w+\-/=]+$/.test(id),
      hint: "<sessionId>",
    },
  },

  // ============ Actions Adapter ============

  actions: {
    listActions: () => ["send"],
    supportsAction: ({ action }: { action: string }) => action === "send",
    extractToolSend: ({ args }: { args: any }) =>
      pluginSdk.extractToolSend(args, "sendMessage"),
    handleAction: async ({ action, params, cfg, accountId, dryRun }: any) => {
      if (action !== "send") {
        throw new Error(
          `Action ${action} is not supported for provider pinsonbot.`
        );
      }

      const to = pluginSdk.readStringParam(params, "to", {
        required: true,
      });
      const message = pluginSdk.readStringParam(params, "message", {
        required: true,
      });

      if (dryRun) {
        return pluginSdk.jsonResult({ ok: true, dryRun: true, to });
      }

      // Find client for this account
      const client = activeClients.get(accountId || "default");
      if (!client) {
        throw new Error(
          "PinsonBot channel not connected. Is the gateway running?"
        );
      }

      // Send message through WebSocket
      const success = client.sendAssistantResponse(message, to);

      if (!success) {
        throw new Error("Failed to send message - client not connected");
      }

      return pluginSdk.jsonResult({ ok: true, to });
    },
  },

  // ============ Outbound Adapter ============

  outbound: {
    deliveryMode: "direct" as const,

    resolveTarget: ({ to }: any) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false as const,
          error: new Error(
            "PinsonBot message requires --to <sessionId>"
          ),
        };
      }
      return { ok: true as const, to: trimmed };
    },

    sendText: async ({ cfg, to, text, accountId, log }: any) => {
      const client = activeClients.get(accountId || "default");
      if (!client) {
        throw new Error("PinsonBot channel not connected");
      }

      const success = client.sendAssistantResponse(text, to);

      if (!success) {
        throw new Error("Failed to send message");
      }

      return {
        channel: "pinsonbot",
        messageId: `pb-${Date.now()}`,
      };
    },
  },

  // ============ Gateway Adapter (core) ============

  gateway: {
    startAccount: async (
      ctx: GatewayStartContext
    ): Promise<GatewayStopResult> => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      // Initialize auto-updater (once per plugin load)
      const updater = getUpdater(PLUGIN_DIR);
      updater.setNotifyCallback((message) => {
        ctx.log?.info?.(`[Updater] ${message}`);
      });

      // Enable auto-install
      updater.setAutoInstall(true);

      // Start periodic update check (every 6 hours)
      updater.startPeriodicCheck(6 * 60 * 60 * 1000);

      // Get account config
      const accountConfig = config.accounts?.[account.accountId];
      if (!accountConfig?.lobsterId || !accountConfig?.internalToken) {
        throw new Error(
          "PinsonBot lobsterId and internalToken are required"
        );
      }

      ctx.log?.info?.(
        `[${account.accountId}] Initializing PinsonBot WebSocket client...`
      );
      ctx.log?.info?.(
        `[${account.accountId}] Lobster ID: ${accountConfig.lobsterId}`
      );

      // Create WebSocket client
      const client = new PinsonBotWSClient(
        accountConfig.lobsterId,
        accountConfig.internalToken,
        config.endpoint,
        {
          maxReconnectAttempts: config.retry?.maxAttempts,
          reconnectDelay: config.retry?.delayMs,
          reconnectBackoff: config.retry?.backoffMultiplier,
        }
      );

      // Track active client
      activeClients.set(account.accountId, client);

      // Setup event handlers
      client.on("connected", () => {
        ctx.setStatus?.({
          ...ctx.getStatus?.(),
          running: true,
          lastStartAt: Date.now(),
          lastError: null,
        });
        ctx.log?.info?.(
          `[${account.accountId}] Connected to PinsonBots Platform`
        );
      });

      client.on("disconnected", ({ code, reason }: { code: number; reason: string }) => {
        // Clear stale in-flight locks on disconnect
        const keyPrefix = `${account.accountId}:`;
        for (const key of processingDedupKeys.keys()) {
          if (key.startsWith(keyPrefix)) {
            processingDedupKeys.delete(key);
          }
        }
        // Only set lastError for abnormal disconnects (not normal close or reconnects)
        const isError = code !== 1000 && code !== 1001;
        ctx.setStatus?.({
          ...ctx.getStatus?.(),
          running: false,
          lastError: isError ? `Disconnected: ${code} ${reason}` : null,
        });
        if (isError) {
          ctx.log?.warn?.(
            `[${account.accountId}] Disconnected: ${code} ${reason}`
          );
        } else {
          ctx.log?.info?.(
            `[${account.accountId}] Disconnected: ${code} ${reason}`
          );
        }
      });

      client.on("user_message", async ({ 
        content, 
        sessionId, 
        conversationId,
        userId,
        userRole
      }: { 
        content: string; 
        sessionId: string; 
        conversationId?: number;
        userId?: string;
        userRole?: string;
      }) => {
        await handleInboundMessage(
          { content, sessionId, conversationId, userId, userRole },
          client,
          ctx,
          account
        );
      });

      client.on("error", ({ type, error }: { type: string; error: Error }) => {
        ctx.log?.error?.(
          `[${account.accountId}] Client error (${type}): ${error.message}`
        );
      });

      // Track abort listener for cleanup
      let abortListener: (() => void) | null = null;
      let isStopped = false;

      // Check if already aborted
      if (abortSignal?.aborted) {
        ctx.log?.warn?.(
          `[${account.accountId}] Abort signal already active, skipping connection`
        );
        throw new Error("Connection aborted before start");
      }

      // Connect and wait for initial connection (with timeout)
      client.connect();

      // Wait for connection to establish (up to 10 seconds)
      const connectionTimeout = 10000;
      const connectionPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, connectionTimeout);

        client.once("connected", () => {
          clearTimeout(timeout);
          resolve();
        });

        client.once("error", (err) => {
          clearTimeout(timeout);
          reject(err.error);
        });
      });

      try {
        await connectionPromise;
      } catch (error) {
        ctx.log?.error?.(`[${account.accountId}] Failed to connect: ${error}`);
        throw error;
      }

      // Explicitly set running status before returning
      ctx.setStatus?.({
        ...ctx.getStatus?.(),
        running: true,
        lastStartAt: Date.now(),
        lastError: null,
      });

      ctx.log?.info?.(`[${account.accountId}] PinsonBot plugin initialized`);

      // Return a Promise that stays pending until stopped via abortSignal
      // Gateway expects startAccount to stay pending; it uses abortSignal to signal stop
      return new Promise<GatewayStopResult>((resolve) => {
        const cleanup = () => {
          if (isStopped) return;
          isStopped = true;
          ctx.log?.info?.(
            `[${account.accountId}] Stopping PinsonBot plugin...`
          );
          if (abortListener && abortSignal) {
            abortSignal.removeEventListener("abort", abortListener);
          }
          client.disconnect();
          activeClients.delete(account.accountId);
          ctx.setStatus?.({
            ...ctx.getStatus?.(),
            running: false,
            lastStopAt: Date.now(),
          });
          ctx.log?.info?.(`[${account.accountId}] PinsonBot plugin stopped`);
          resolve({
            stop: cleanup // Return stop function for Gateway to call
          });
        };

        // Set up abort listener to stop and resolve the promise
        if (abortSignal) {
          abortListener = cleanup;
          abortSignal.addEventListener("abort", abortListener);
        }
      });
    },
  },
};

// ============ Inbound Message Handler ============

async function handleInboundMessage(
  message: { 
    content: string; 
    sessionId: string; 
    conversationId?: number;
    userId?: string;
    userRole?: string;
  },
  client: PinsonBotWSClient,
  ctx: GatewayStartContext,
  account: ResolvedAccount
): Promise<void> {
  const { content, sessionId, conversationId, userId, userRole } = message;

  // Debug: log the full message structure
  ctx.log?.info?.(`[${account.accountId}] DEBUG handleInboundMessage: ${JSON.stringify(message)}`);

  const stats = getInboundCounters(account.accountId);
  stats.received += 1;

  // Safety check for undefined content
  const safeContent = content || "";
  ctx.log?.info?.(
    `[${account.accountId}] User message: ${safeContent.substring(0, 100)}${
      safeContent.length > 100 ? "..." : ""
    }`
  );

  // ============ Security Isolation: Identify Role ============
  // NEW: Determine role based on user_role only
  // user_role: owner|admin|member|guest
  let role: "admin" | "user" = "user";
  let targetAgentId = "user";
  
  if (userRole === "owner" || userRole === "admin") {
    role = "admin";
    targetAgentId = "admin";
  } else if (userRole === "member" || userRole === "guest") {
    role = "user";
    targetAgentId = "user";
  } else {
    // Fallback: use session pattern detection for backward compatibility
    const sessionKeyForRole = sessionId.startsWith('pinsonbot:') ? sessionId : `pinsonbot:${sessionId}`;
    role = getSessionRole(sessionKeyForRole);
    targetAgentId = getTargetAgentId(sessionKeyForRole);
  }
  
  // SessionKey 逻辑：
  // - 如果 sessionId 已包含 `:` 说明是完整格式（群聊或新格式），直接使用
  // - 否则构建新格式：pinsonbot:{lobster_id}:{user_role}:{user_id}
  let sessionKey: string;
  if (sessionId.includes(':')) {
    // 已经是完整格式，直接使用
    sessionKey = sessionId;
  } else {
    // 旧格式（纯数字），构建新格式
    const lobsterId = account.config.accounts?.[account.accountId]?.lobsterId || "unknown";
    const effectiveUserRole = userRole || (role === "admin" ? "admin" : "user");
    const effectiveUserId = userId || "unknown";
    sessionKey = `pinsonbot:${lobsterId}:${effectiveUserRole}:${effectiveUserId}`;
  }
  
  ctx.log?.info?.(
    `[${account.accountId}] Session: ${sessionKey}, Role: ${role}, Target Agent: ${targetAgentId}`
  );

  // Security Isolation: 根据角色添加权限提示
  const rolePrompt = role === "admin" 
    ? `\n\n[系统提示：你是管理员助手，拥有完整权限。你可以执行命令、修改文件、管理系统等管理员操作。请谨慎使用这些权限，确保操作安全。]\n\n`
    : `\n\n[系统提示：你是用户助手，只能使用安全的工具（搜索、阅读）。如果用户请求执行命令、修改文件或其他管理员操作，请礼貌地告知这需要管理员权限，建议用户联系管理员。]\n\n`;

  // 根据角色添加权限提示
  const processedContent = rolePrompt + safeContent;

  // Message deduplication
  const dedupKey = `${account.accountId}:${sessionId}:${safeContent}:${Date.now()}`;
  if (isMessageProcessed(dedupKey)) {
    ctx.log?.debug?.(`[${account.accountId}] Skipping duplicate message`);
    stats.dedupSkipped += 1;
    return;
  }

  // In-flight guard
  const inflightSince = processingDedupKeys.get(dedupKey);
  if (inflightSince !== undefined) {
    if (Date.now() - inflightSince > INFLIGHT_TTL_MS) {
      processingDedupKeys.delete(dedupKey);
    } else {
      ctx.log?.debug?.(`[${account.accountId}] Skipping in-flight duplicate`);
      stats.inflightSkipped += 1;
      return;
    }
  }
  processingDedupKeys.set(dedupKey, Date.now());

  // Send typing indicator
  client.sendTypingIndicator(sessionId, true);

  try {
    // Check if channelRuntime is available for AI dispatch
    if (!ctx.channelRuntime?.reply) {
      ctx.log?.error?.(`[${account.accountId}] channelRuntime.reply not available - cannot dispatch AI`);
      client.sendTypingIndicator(sessionId, false);
      client.sendAssistantResponse("⚠️ AI 服务配置错误，请联系管理员", sessionId);
      stats.failed += 1;
      return;
    }

    let fullResponse = "";

    // Use OpenClaw's reply dispatcher for AI response
    // Security Isolation: Pass role and target agent in context
    ctx.log?.info?.(`[${account.accountId}] Calling dispatchReplyWithBufferedBlockDispatcher (role=${role}, agent=${targetAgentId})...`);
    
    const result = await ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: {
        cfg: ctx.cfg,
        peerId: sessionId,
        text: processedContent,
        Body: processedContent,
        BodyForAgent: processedContent,
        SessionKey: sessionKey,
        AccountId: account.accountId,
        ChatType: "direct",
        From: sessionId,
        // Security Isolation: Add role and target agent info
        _securityContext: {
          role,
          targetAgentId,
          isAdmin: role === "admin",
        },
      } as any,
      cfg: ctx.cfg,
      dispatcherOptions: {
        deliver: async (payload) => {
          ctx.log?.info?.(`[${account.accountId}] deliver callback called: ${JSON.stringify(payload).substring(0, 100)}`);
          const text = payload.text || "";
          if (text) {
            fullResponse += text;
            client.sendStreamToken(text, sessionId);
          }
        },
      },
    });
    
    ctx.log?.info?.(`[${account.accountId}] dispatchReply result: ${JSON.stringify(result).substring(0, 200)}`);

    // End typing
    client.sendTypingIndicator(sessionId, false);

    // Send final complete message (for persistence)
    if (fullResponse) {
      client.sendAssistantResponse(fullResponse, sessionId, conversationId);
    }

    ctx.log?.info?.(
      `[${account.accountId}] AI response: ${fullResponse.substring(0, 100)}${
        fullResponse.length > 100 ? "..." : ""
      }`
    );

    markMessageProcessed(dedupKey);
    stats.processed += 1;
  } catch (error: any) {
    ctx.log?.error?.(
      `[${account.accountId}] AI processing error: ${error.message}`
    );

    // End typing
    client.sendTypingIndicator(sessionId, false);

    // Send error to user
    client.sendAssistantResponse(
      `⚠️ 处理失败：${error.message}`,
      sessionId
    );

    stats.failed += 1;
  } finally {
    processingDedupKeys.delete(dedupKey);
  }
}

// ============ Gateway AI Dispatch ============

/**
 * Dispatch a user message to OpenClaw Gateway AI using channelRuntime.
 */
async function dispatchToGatewayStreaming(
  ctx: GatewayStartContext,
  message: string,
  sessionId: string,
  account: ResolvedAccount,
  onToken: (token: string) => void
): Promise<string> {
  // Check if channelRuntime is available
  if (!ctx.channelRuntime) {
    ctx.log?.error?.(`[${account.accountId}] channelRuntime not available in context`);
    return "⚠️ AI 服务暂时不可用（channelRuntime 未初始化）";
  }

  const { reply, routing } = ctx.channelRuntime;

  if (!reply) {
    ctx.log?.error?.(`[${account.accountId}] channelRuntime.reply not available`);
    return "⚠️ AI 服务暂时不可用";
  }

  try {
    // Build session key directly (avoid double prefix)
    const sessionKey = sessionId.startsWith('pinsonbot:') ? sessionId : `pinsonbot:${sessionId}`;

    ctx.log?.info?.(`[${account.accountId}] Dispatching to AI, sessionKey=${sessionKey}, message="${message}"`);

    let fullResponse = "";

    // Use dispatchReplyWithBufferedBlockDispatcher with proper MsgContext
    const result = await reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: {
        channel: "pinsonbot",
        peer: { id: sessionId, kind: "direct" },
        Body: message,
        BodyForAgent: message,
        text: message,
        sessionKey,
        AccountId: account.accountId,
        ChatType: "direct",
      } as any,
      cfg: ctx.cfg,
      dispatcherOptions: {
        deliver: async (payload: any) => {
          const text = payload.text || "";
          if (text) {
            fullResponse += text;
            onToken(text);
          }
        },
      },
    });

    return fullResponse || "⚠️ 未收到回复";
  } catch (error: any) {
    ctx.log?.error?.(`[${account.accountId}] AI dispatch error: ${error.message}`);
    return `⚠️ 处理失败：${error.message}`;
  }
}
