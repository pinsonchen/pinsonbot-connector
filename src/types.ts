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
    user_id?: string;      // 新增: 用户ID
    user_role?: string;    // 新增: 用户角色 (owner|admin|member|guest)
    is_owner?: boolean;    // 新增: 是否为所有者
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
    user_id?: string;      // 新增: 用户ID
    user_role?: string;    // 新增: 用户角色
    is_owner?: boolean;    // 新增: 是否为所有者
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
    userId?: string;       // 新增
    userRole?: string;     // 新增
    isOwner?: boolean;     // 新增
    timestamp?: string; 
  };
  history: { sessionId: string; messages: any[] };
  error: { type: string; error: Error };
  server_error: any;
}
