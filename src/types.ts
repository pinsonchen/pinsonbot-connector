/**
 * Type definitions for PinsonBot Channel Plugin
 *
 * Aligned with OpenClaw Plugin SDK ChannelPlugin contract.
 */

import type {
  OpenClawConfig,
  OpenClawPluginApi,
  ChannelLogSink as SDKChannelLogSink,
  ChannelAccountSnapshot as SDKChannelAccountSnapshot,
  ChannelGatewayContext,
  ChannelPlugin,
} from "openclaw/plugin-sdk";

// ============ Plugin Module ============

export interface PinsonBotPluginModule {
  id: string;
  name: string;
  description?: string;
  configSchema?: unknown;
  register?: (api: OpenClawPluginApi) => void | Promise<void>;
}

// ============ Configuration ============

export interface PinsonBotConfig {
  enabled?: boolean;
  /** PinsonBots Platform endpoint */
  endpoint?: string;
  /** Multiple accounts configuration */
  accounts: Record<string, PinsonBotAccountConfig>;
  /** Connection retry configuration */
  retry?: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  };
  /** Health check configuration */
  healthCheck?: {
    enabled?: boolean;
    intervalMs?: number;
  };
}

export interface PinsonBotAccountConfig {
  enabled?: boolean;
  /** Lobster ID from PinsonBots Platform */
  lobsterId: string;
  /** Internal token for Plugin WebSocket authentication */
  internalToken: string;
  /** Optional: Account display name */
  name?: string;
}

// ============ Resolved Account ============

export interface ResolvedAccount {
  accountId: string;
  config: PinsonBotConfig;
  enabled: boolean;
  configured: boolean;
  name?: string | null;
}

// ============ Channel Plugin Type ============

export type PinsonBotChannelPlugin = ChannelPlugin<ResolvedAccount>;

// ============ Gateway Context ============

export type GatewayStartContext = ChannelGatewayContext<ResolvedAccount>;

export interface GatewayStopResult {
  stop: () => void;
}

// ============ SDK Re-exports ============

export type ChannelLogSink = SDKChannelLogSink;
export type ChannelAccountSnapshot = SDKChannelAccountSnapshot;

// ============ PinsonBots Protocol ============

export interface PinsonBotMessage {
  type: string;
  data: {
    content?: string;
    session_id?: string;
    user_id?: string;      // 用户ID
    user_role?: string;    // 用户角色 (owner|admin|member|guest)
    role?: string;
    messages?: any[];
    [key: string]: any;
  };
  timestamp?: string;
  lobster_id?: string;
}

export interface PinsonBotInboundMessage {
  type: "message" | "history" | "connected" | "error";
  data: {
    content?: string;
    session_id: string;
    user_id?: string;      // 用户ID
    user_role?: string;    // 用户角色
    conversation_id?: number;
    role?: string;
    messages?: any[];
  };
  timestamp?: string;
}

// ============ WebSocket Client Events ============

export interface WSClientEvents {
  connected: { lobsterId: string };
  disconnected: { code: number; reason: string };
  user_message: { 
    content: string; 
    sessionId: string; 
    userId?: string;       // 用户ID
    userRole?: string;     // 用户角色
    timestamp?: string; 
  };
  history: { sessionId: string; messages: any[] };
  history_sync: { sessionId: string; success: boolean; count: number };
  error: { type: string; error: Error };
  server_error: any;
}

// ============ History Sync Types ============

export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  conversation_id?: number;
}

export interface HistorySyncConfig {
  /** 是否启用历史同步到平台 */
  enabled: boolean;
  /** 同步模式: "realtime" 实时同步 | "batch" 批量同步 */
  mode: "realtime" | "batch";
  /** 批量同步间隔（毫秒），mode=batch 时有效 */
  batchIntervalMs?: number;
  /** 最大缓存条数 */
  maxCacheSize?: number;
}

// ============ Token Usage Types ============

/**
 * Token 使用数据
 * 从 OpenClaw DiagnosticUsageEvent 提取
 */
export interface TokenUsage {
  /** 输入 token 数 */
  input_tokens?: number;
  /** 输出 token 数 */
  output_tokens?: number;
  /** 缓存读取 token 数 */
  cache_read_tokens?: number;
  /** 缓存写入 token 数 */
  cache_write_tokens?: number;
  /** 总 token 数 */
  total_tokens?: number;
  /** 模型名称 */
  model?: string;
  /** 提供商名称 */
  provider?: string;
  /** 费用（美元） */
  cost_usd?: number;
  /** 响应时间（毫秒） */
  duration_ms?: number;
  /** 上下文限制 */
  context_limit?: number;
  /** 上下文已使用 */
  context_used?: number;
}

/**
 * Token 使用同步消息
 */
export interface TokenUsageMessage {
  type: "token_usage";
  data: {
    session_id: string;
    lobster_id: string;
    usage: TokenUsage;
    timestamp: string;
  };
}
