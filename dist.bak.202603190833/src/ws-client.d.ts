/**
 * WebSocket client for PinsonBots Platform Plugin endpoint
 *
 * Features:
 * - Per-lobster authentication with internal_token
 * - Automatic reconnection with exponential backoff
 * - Message queue for offline handling
 * - Health check monitoring
 */
import { EventEmitter } from "events";
import type { HistoryMessage, HistorySyncConfig, TokenUsage, ApiCallStats, ImageContent, AudioContent, VideoContent, MessageAttachment } from "./types.js";
interface WSMessage {
    type: string;
    data: any;
    timestamp?: string;
}
export declare class PinsonBotWSClient extends EventEmitter {
    private ws;
    private lobsterId;
    private internalToken;
    private endpoint;
    private connected;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectDelay;
    private reconnectBackoff;
    private messageQueue;
    private healthCheckInterval?;
    private lastPongTime?;
    private conversationHistory;
    private maxHistoryLength;
    private platformRecoveryInterval?;
    private isManualDisconnect;
    private historySyncConfig;
    private pendingSync;
    private batchSyncInterval?;
    private heartbeatInterval?;
    private heartbeatTimeout?;
    private lastHeartbeatSent?;
    private lastHeartbeatAck?;
    private heartbeatStats;
    private heartbeatIntervalMs;
    private heartbeatTimeoutMs;
    private maxHeartbeatFailures;
    private consecutiveHeartbeatFailures;
    constructor(lobsterId: string, internalToken: string, endpoint?: string, options?: {
        maxReconnectAttempts?: number;
        reconnectDelay?: number;
        reconnectBackoff?: number;
        historySync?: Partial<HistorySyncConfig>;
        heartbeatIntervalMs?: number;
        heartbeatTimeoutMs?: number;
        maxHeartbeatFailures?: number;
    });
    /**
     * Connect to PinsonBots Platform
     */
    connect(): void;
    /**
     * Disconnect from PinsonBots Platform
     */
    disconnect(): void;
    /**
     * Send a message to the platform
     */
    sendMessage(message: WSMessage): boolean;
    /**
     * Send assistant response
     */
    sendAssistantResponse(content: string, sessionId: string, conversationId?: number): boolean;
    /**
     * Send assistant response with media (ACP standard)
     * Supports images, audio, video attachments
     */
    sendAssistantResponseWithMedia(content: string, sessionId: string, media: {
        images?: ImageContent[];
        audio?: AudioContent[];
        video?: VideoContent[];
        attachments?: MessageAttachment[];
    }, conversationId?: number): boolean;
    /**
     * Send image response (helper method)
     */
    sendImageResponse(content: string, sessionId: string, images: ImageContent[], conversationId?: number): boolean;
    /**
     * Send media response via URL
     * 用于发送图片、音频、视频等媒体文件
     */
    sendMediaResponse(mediaUrl: string, mediaType: string, sessionId: string, conversationId?: number): boolean;
    /**
     * Send stream token (for real-time streaming from OpenClaw)
     */
    sendStreamToken(token: string, sessionId: string): boolean;
    /**
     * Send typing indicator
     */
    sendTypingIndicator(sessionId: string, isTyping: boolean): boolean;
    /**
     * Send token usage to platform
     * 同步当次会话的 token 使用数据
     */
    sendTokenUsage(sessionId: string, usage: TokenUsage): boolean;
    /**
     * Send API call stats to platform
     * 同步当次会话的 API 调用次数（用于不支持 token usage 的模型）
     */
    sendApiCall(sessionId: string, stats: ApiCallStats): boolean;
    /**
     * Request conversation history
     */
    requestHistory(sessionId: string): boolean;
    /**
     * Send connection status update
     */
    sendStatusUpdate(status: "connected" | "disconnected" | "busy"): boolean;
    /**
     * Check if currently connected
     */
    isConnected(): boolean;
    /**
     * Send metadata to PinsonBots Platform
     * Called after connection is established
     */
    sendMetadata(): boolean;
    /**
     * Store message in conversation history and sync to platform
     */
    private storeMessage;
    /**
     * Add message to pending sync queue (for batch mode)
     */
    private addToPendingSync;
    /**
     * Push history to platform
     */
    private pushHistoryToPlatform;
    /**
     * Start batch sync timer
     */
    private startBatchSync;
    /**
     * Stop batch sync timer
     */
    private stopBatchSync;
    /**
     * Flush pending sync messages to platform
     */
    private flushPendingSync;
    /**
     * Import history from platform (for recovery)
     */
    importHistory(sessionId: string, messages: HistoryMessage[]): void;
    /**
     * Handle history request from platform
     */
    private handleHistoryRequest;
    /**
     * Get conversation history for a session
     */
    getHistory(sessionId: string, limit?: number): HistoryMessage[];
    /**
     * Get all conversation histories
     */
    getAllHistories(): Map<string, HistoryMessage[]>;
    /**
     * Clear conversation history for a session
     */
    clearHistory(sessionId?: string): void;
    /**
     * Handle incoming messages
     */
    private handleMessage;
    /**
     * Schedule reconnection after disconnection
     */
    private scheduleReconnect;
    /**
     * Start periodic platform recovery check
     * 当达到最大重连次数后，定期检测平台是否恢复
     */
    private startPlatformRecoveryCheck;
    /**
     * Stop platform recovery check
     */
    private stopPlatformRecoveryCheck;
    /**
     * Process queued messages
     */
    private processMessageQueue;
    /**
     * Start health check monitoring
     */
    private startHealthCheck;
    /**
     * Stop health check monitoring
     */
    private stopHealthCheck;
    /**
     * Start application-level heartbeat
     */
    private startHeartbeat;
    /**
     * Stop application-level heartbeat
     */
    private stopHeartbeat;
    /**
     * Send heartbeat with updated metadata
     */
    sendHeartbeat(): boolean;
    /**
     * Get heartbeat statistics
     */
    getHeartbeatStats(): {
        sent: number;
        acked: number;
        failed: number;
        successRate: number;
        lastSuccessTime?: number;
        lastFailTime?: number;
        consecutiveFailures: number;
    };
    /**
     * Reset heartbeat statistics
     */
    resetHeartbeatStats(): void;
    /**
     * Get enhanced connection statistics
     */
    getStats(): {
        connected: boolean;
        lobsterId: string;
        queueLength: number;
        reconnectAttempts: number;
        historySessions: number;
        heartbeat?: {
            sent: number;
            acked: number;
            failed: number;
            successRate: number;
            consecutiveFailures: number;
        };
    };
}
export {};
//# sourceMappingURL=ws-client.d.ts.map