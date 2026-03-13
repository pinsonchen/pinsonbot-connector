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
      const updater = getUpdater();
      updater.setNotifyCallback((message) => {
        ctx.log?.info?.(`[Updater] ${message}`);
      });

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

      client.on("user_message", async ({ content, sessionId, conversationId }: { content: string; sessionId: string; conversationId?: number }) => {
        await handleInboundMessage(
          { content, sessionId, conversationId },
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

      // Listen for abort signal
      if (abortSignal) {
        if (abortSignal.aborted) {
          ctx.log?.warn?.(
            `[${account.accountId}] Abort signal already active, skipping connection`
          );
          throw new Error("Connection aborted before start");
        }
        abortListener = () => {
          ctx.log?.info?.(
            `[${account.accountId}] Abort signal received, stopping...`
          );
          client.disconnect();
          activeClients.delete(account.accountId);
        };
        abortSignal.addEventListener("abort", abortListener);
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

      return {
        stop: () => {
          ctx.log?.info?.(
            `[${account.accountId}] Stopping PinsonBot plugin...`
          );
          // Remove abort listener to prevent double-cleanup
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
        },
      };
    },
  },
};

// ============ Inbound Message Handler ============

async function handleInboundMessage(
  message: { content: string; sessionId: string; conversationId?: number },
  client: PinsonBotWSClient,
  ctx: GatewayStartContext,
  account: ResolvedAccount
): Promise<void> {
  const { content, sessionId, conversationId } = message;

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
    ctx.log?.info?.(`[${account.accountId}] Calling dispatchReplyWithBufferedBlockDispatcher...`);
    
    const result = await ctx.channelRuntime.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: {
        cfg: ctx.cfg,
        peerId: sessionId,
        text: safeContent,
        Body: safeContent,
        BodyForAgent: safeContent,
        SessionKey: `pinsonbot:${sessionId}`,
        AccountId: account.accountId,
        ChatType: "direct",
        From: sessionId,
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
    // Build session key directly
    const sessionKey = `pinsonbot:${sessionId}`;

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
