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
        ctx.setStatus?.({
          ...ctx.getStatus?.(),
          running: false,
          lastError: `Disconnected: ${code} ${reason}`,
        });
        ctx.log?.warn?.(
          `[${account.accountId}] Disconnected: ${code} ${reason}`
        );
      });

      client.on("user_message", async ({ content, sessionId }: { content: string; sessionId: string }) => {
        await handleInboundMessage(
          { content, sessionId },
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

      // Listen for abort signal
      if (abortSignal) {
        if (abortSignal.aborted) {
          ctx.log?.warn?.(
            `[${account.accountId}] Abort signal already active, skipping connection`
          );
          throw new Error("Connection aborted before start");
        }
        abortSignal.addEventListener("abort", () => {
          ctx.log?.info?.(
            `[${account.accountId}] Abort signal received, stopping...`
          );
          client.disconnect();
          activeClients.delete(account.accountId);
        });
      }

      // Connect
      client.connect();

      ctx.log?.info?.(`[${account.accountId}] PinsonBot plugin initialized`);

      return {
        stop: () => {
          ctx.log?.info?.(
            `[${account.accountId}] Stopping PinsonBot plugin...`
          );
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

  const stats = getInboundCounters(account.accountId);
  stats.received += 1;

  ctx.log?.info?.(
    `[${account.accountId}] User message: ${content.substring(0, 100)}${
      content.length > 100 ? "..." : ""
    }`
  );

  // Message deduplication
  const dedupKey = `${account.accountId}:${sessionId}:${content}:${Date.now()}`;
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
    // Dispatch to Gateway AI via the SDK runtime
    const response = await dispatchToGateway(ctx, content, sessionId, account);

    // End typing
    client.sendTypingIndicator(sessionId, false);

    // Send AI response (with conversation_id for persistence)
    client.sendAssistantResponse(response, sessionId, conversationId);

    ctx.log?.info?.(
      `[${account.accountId}] AI response: ${response.substring(0, 100)}${
        response.length > 100 ? "..." : ""
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
 * Dispatch a user message to OpenClaw Gateway AI.
 *
 * Uses the OpenClaw Plugin SDK runtime chat dispatch.
 */
async function dispatchToGateway(
  ctx: GatewayStartContext,
  message: string,
  sessionId: string,
  account: ResolvedAccount
): Promise<string> {
  // Use SDK runtime chat dispatch via the context
  const sendToGateway = (ctx as any).sendToGateway;
  if (typeof sendToGateway === "function") {
    const response = await sendToGateway({
      peerId: sessionId,
      text: message,
      accountId: account.accountId,
    });
    return response.text || response.content || "⚠️ 未收到回复";
  }

  // Fallback if SDK method not available
  ctx.log?.error?.(`[${account.accountId}] sendToGateway not available in context`);
  return "⚠️ AI 服务暂时不可用";
}
