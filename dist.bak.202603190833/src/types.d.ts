/**
 * Type definitions for PinsonBot Channel Plugin
 *
 * Aligned with OpenClaw Plugin SDK ChannelPlugin contract.
 */
import type { OpenClawPluginApi, ChannelLogSink as SDKChannelLogSink, ChannelAccountSnapshot as SDKChannelAccountSnapshot, ChannelGatewayContext, ChannelPlugin } from "openclaw/plugin-sdk";
export interface PinsonBotPluginModule {
    id: string;
    name: string;
    description?: string;
    configSchema?: unknown;
    register?: (api: OpenClawPluginApi) => void | Promise<void>;
}
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
export interface ResolvedAccount {
    accountId: string;
    config: PinsonBotConfig;
    enabled: boolean;
    configured: boolean;
    name?: string | null;
}
export type PinsonBotChannelPlugin = ChannelPlugin<ResolvedAccount>;
export type GatewayStartContext = ChannelGatewayContext<ResolvedAccount>;
export interface GatewayStopResult {
    stop: () => void;
}
export type ChannelLogSink = SDKChannelLogSink;
export type ChannelAccountSnapshot = SDKChannelAccountSnapshot;
/**
 * Image content following AgentClientProtocol standard
 * @see https://agentclientprotocol.com
 *
 * Re-export from @mariozechner/pi-ai for OpenClaw compatibility
 */
export type { ImageContent } from "@mariozechner/pi-ai";
/**
 * Helper function to create ImageContent
 */
export declare function createImageContent(data: string, mimeType: string): import("@mariozechner/pi-ai").ImageContent;
/**
 * Audio content following AgentClientProtocol standard
 */
export interface AudioContent {
    /** Base64 encoded audio data */
    data: string;
    /** MIME type: "audio/mp3" | "audio/wav" | "audio/ogg" | "audio/m4a" | etc. */
    mimeType: string;
    /** Optional annotations */
    annotations?: {
        audience?: string[];
        lastModified?: string;
        priority?: number;
    } | null;
}
/**
 * Video content following AgentClientProtocol standard
 */
export interface VideoContent {
    /** Base64 encoded video data or URL */
    data?: string;
    /** MIME type: "video/mp4" | "video/webm" | etc. */
    mimeType: string;
    /** URL to video (alternative to data) */
    uri?: string | null;
    /** Optional annotations */
    annotations?: {
        audience?: string[];
        lastModified?: string;
        priority?: number;
    } | null;
}
/**
 * Union type for all media content types
 */
export type MediaContent = import("@mariozechner/pi-ai").ImageContent | AudioContent | VideoContent;
/**
 * Attachment for message sending (ACP compatible)
 */
export interface MessageAttachment {
    /** Content type discriminator */
    type: "image" | "audio" | "video";
    /** Media data */
    data: string;
    /** MIME type */
    mimeType: string;
    /** Optional URI */
    uri?: string | null;
}
export interface PinsonBotMessage {
    type: string;
    data: {
        content?: string;
        session_id?: string;
        user_id?: string;
        user_role?: string;
        role?: string;
        messages?: any[];
        /** Media attachments (ACP standard) */
        images?: import("@mariozechner/pi-ai").ImageContent[];
        audio?: AudioContent[];
        video?: VideoContent[];
        attachments?: MessageAttachment[];
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
        user_id?: string;
        user_role?: string;
        conversation_id?: number;
        role?: string;
        messages?: any[];
        /** Media attachments (ACP standard) */
        images?: import("@mariozechner/pi-ai").ImageContent[];
        audio?: AudioContent[];
        video?: VideoContent[];
        attachments?: MessageAttachment[];
    };
    timestamp?: string;
}
export interface WSClientEvents {
    connected: {
        lobsterId: string;
    };
    disconnected: {
        code: number;
        reason: string;
    };
    user_message: {
        content: string;
        sessionId: string;
        userId?: string;
        userRole?: string;
        timestamp?: string;
        /** Media attachments (ACP standard) */
        images?: import("@mariozechner/pi-ai").ImageContent[];
        audio?: AudioContent[];
        video?: VideoContent[];
        attachments?: MessageAttachment[];
    };
    history: {
        sessionId: string;
        messages: any[];
    };
    history_sync: {
        sessionId: string;
        success: boolean;
        count: number;
    };
    error: {
        type: string;
        error: Error;
    };
    server_error: any;
}
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
 * API 调用统计
 * 用于不支持 token usage 的模型（如百炼 Coding Plan）
 */
export interface ApiCallStats {
    /** 本次会话 API 调用次数 */
    call_count: number;
    /** 模型名称 */
    model?: string;
    /** 提供商名称 */
    provider?: string;
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
/**
 * API 调用统计消息
 */
export interface ApiCallMessage {
    type: "api_call";
    data: {
        session_id: string;
        lobster_id: string;
        stats: ApiCallStats;
        timestamp: string;
    };
}
//# sourceMappingURL=types.d.ts.map