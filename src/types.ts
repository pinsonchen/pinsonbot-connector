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

// ============ ACP Standard Media Types ============

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
export function createImageContent(data: string, mimeType: string): import("@mariozechner/pi-ai").ImageContent {
  return { type: "image", data, mimeType };
}

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

// ============ PinsonBots Protocol ============

export interface PinsonBotMessage {
  type: string;
  data: {
    content?: string;
    session_id?: string;
    user_id?: string;      // 用户ID
    user_role?: string;    // 用户角色 (owner|guest)
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
    user_id?: string;      // 用户ID
    user_role?: string;    // 用户角色
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
    /** Media attachments (ACP standard) */
    images?: import("@mariozechner/pi-ai").ImageContent[];
    audio?: AudioContent[];
    video?: VideoContent[];
    attachments?: MessageAttachment[];
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

// ============ Multi-Message Response Types (v2.16.0) ============

/**
 * 响应类型 - 支持一条用户输入对应多条 AI 响应
 * 
 * @example
 * // Tool call notification
 * { response_type: 'tool_call', content: '正在查询天气...', metadata: { tool_name: 'weather_query' } }
 * 
 * // Tool execution result
 * { response_type: 'tool_result', content: '北京今天晴朗，25°C', metadata: { tool_name: 'weather_query', execution_time_ms: 234 } }
 * 
 * // Intermediate conclusion (streaming scenario)
 * { response_type: 'intermediate', content: '根据数据分析...', sequence: 2 }
 * 
 * // Final response (updates main conversation record)
 * { response_type: 'final', content: '综上所述，建议您带伞出门。', sequence: 3 }
 * 
 * // Error response
 * { response_type: 'error', content: '工具调用失败', metadata: { error_code: 'TOOL_TIMEOUT' } }
 */
export type ResponseType = 
  | 'tool_call'      // 工具调用通知
  | 'tool_result'    // 工具执行结果
  | 'intermediate'   // 中间结论（流式场景）
  | 'final'          // 最终回复（更新主记录）
  | 'error';         // 错误信息

/**
 * 响应元数据 - 携带额外上下文信息
 * 
 * @example
 * // Tool call metadata
 * { tool_name: 'weather_query', tool_args: { city: '北京' } }
 * 
 * // Tool result metadata
 * { tool_name: 'weather_query', execution_time_ms: 234, tokens_used: 45 }
 * 
 * // Error metadata
 * { error_code: 'TOOL_TIMEOUT', retry_count: 2 }
 */
export interface ResponseMetadata {
  /** 工具名称（tool_call/tool_result 时必填） */
  tool_name?: string;
  /** 工具参数（tool_call 时使用） */
  tool_args?: Record<string, any>;
  /** 执行耗时（tool_result 时使用，毫秒） */
  execution_time_ms?: number;
  /** 消耗的 token 数 */
  tokens_used?: number;
  /** 错误码（error 时使用） */
  error_code?: string;
  /** 重试次数（error 时使用） */
  retry_count?: number;
  /** 其他自定义元数据 */
  [key: string]: any;
}

/**
 * 多消息响应消息结构
 * 
 * 用于实现一条用户输入对应多条 AI 响应的场景
 * 
 * @example
 * // 完整的多消息响应流程
 * const responses = [
 *   { response_type: 'tool_call', content: '🔍 正在查询天气...', metadata: { tool_name: 'weather' }, sequence: 0 },
 *   { response_type: 'tool_result', content: '北京：晴，25°C', metadata: { tool_name: 'weather', execution_time_ms: 120 }, sequence: 1 },
 *   { response_type: 'intermediate', content: '根据查询结果...', sequence: 2 },
 *   { response_type: 'final', content: '建议您穿短袖并涂抹防晒霜。', sequence: 3 }
 * ];
 */
export interface MultiBotResponseMessage {
  type: 'bot_response';
  data: {
    /** 响应内容 */
    content: string;
    /** 会话 ID */
    session_id: string;
    /** Lobster ID */
    lobster_id: string;
    /** 对话 ID（可选，用于关联父对话） */
    conversation_id?: number;
    /** 响应类型（默认：'final'） */
    response_type?: ResponseType;
    /** 序列号（用于排序，从 0 开始） */
    sequence?: number;
    /** 元数据 */
    metadata?: ResponseMetadata;
    /** 图片附件（ACP 标准） */
    images?: import("@mariozechner/pi-ai").ImageContent[];
    /** 音频附件（ACP 标准） */
    audio?: AudioContent[];
    /** 视频附件（ACP 标准） */
    video?: VideoContent[];
  };
  /** ISO 8601 时间戳 */
  timestamp: string;
}
