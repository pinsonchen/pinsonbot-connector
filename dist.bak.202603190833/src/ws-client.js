/**
 * WebSocket client for PinsonBots Platform Plugin endpoint
 *
 * Features:
 * - Per-lobster authentication with internal_token
 * - Automatic reconnection with exponential backoff
 * - Message queue for offline handling
 * - Health check monitoring
 */
import WebSocket from "ws";
import { EventEmitter } from "events";
import { collectMetadata, createMetadataMessage, createHeartbeatMessage } from "./metadata.js";
export class PinsonBotWSClient extends EventEmitter {
    ws = null;
    lobsterId;
    internalToken;
    endpoint;
    connected = false;
    reconnectAttempts = 0;
    maxReconnectAttempts;
    reconnectDelay;
    reconnectBackoff;
    messageQueue = [];
    healthCheckInterval;
    lastPongTime;
    conversationHistory = new Map();
    maxHistoryLength = 100;
    platformRecoveryInterval;
    isManualDisconnect = false;
    // History sync
    historySyncConfig;
    pendingSync = new Map();
    batchSyncInterval;
    // Heartbeat enhancement
    heartbeatInterval;
    heartbeatTimeout;
    lastHeartbeatSent;
    lastHeartbeatAck;
    heartbeatStats = { sent: 0, acked: 0, failed: 0 };
    heartbeatIntervalMs;
    heartbeatTimeoutMs;
    maxHeartbeatFailures;
    consecutiveHeartbeatFailures = 0;
    constructor(lobsterId, internalToken, endpoint = "wss://tools.pinsonbot.com/pinsonbots/internal/plugin", options = {}) {
        super();
        this.lobsterId = lobsterId;
        this.internalToken = internalToken;
        this.endpoint = endpoint;
        // Connection options - 默认无限重连
        this.maxReconnectAttempts = options.maxReconnectAttempts || Infinity;
        this.reconnectDelay = options.reconnectDelay || 5000;
        this.reconnectBackoff = options.reconnectBackoff || 2;
        // History sync config
        this.historySyncConfig = {
            enabled: options.historySync?.enabled ?? true,
            mode: options.historySync?.mode ?? "realtime",
            batchIntervalMs: options.historySync?.batchIntervalMs ?? 5000,
            maxCacheSize: options.historySync?.maxCacheSize ?? 1000,
        };
        // Heartbeat options
        this.heartbeatIntervalMs = options.heartbeatIntervalMs || 30000;
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs || 90000;
        this.maxHeartbeatFailures = options.maxHeartbeatFailures || 10;
        // Build WebSocket URL with authentication
        const url = new URL(endpoint);
        url.searchParams.append("token", this.internalToken);
        url.searchParams.append("lobster_id", this.lobsterId);
        this.endpoint = url.toString();
        // Start batch sync timer if needed
        if (this.historySyncConfig.enabled && this.historySyncConfig.mode === "batch") {
            this.startBatchSync();
        }
    }
    /**
     * Connect to PinsonBots Platform
     */
    connect() {
        // 重置手动断开标志
        this.isManualDisconnect = false;
        if (this.ws &&
            (this.ws.readyState === WebSocket.CONNECTING ||
                this.ws.readyState === WebSocket.OPEN)) {
            console.log("[PinsonBotWS] Already connecting or connected");
            return;
        }
        console.log(`[PinsonBotWS] Connecting to ${this.endpoint}`);
        try {
            this.ws = new WebSocket(this.endpoint);
            this.ws.on("open", () => {
                console.log("[PinsonBotWS] Connected successfully");
                this.connected = true;
                this.reconnectAttempts = 0;
                this.isManualDisconnect = false;
                this.consecutiveHeartbeatFailures = 0;
                this.stopPlatformRecoveryCheck();
                this.emit("connected", { lobsterId: this.lobsterId });
                // Send metadata after connection
                this.sendMetadata();
                // Start health checks (both WebSocket ping and application heartbeat)
                this.startHealthCheck();
                this.startHeartbeat();
                // Process queued messages
                this.processMessageQueue();
            });
            this.ws.on("message", (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    this.handleMessage(message);
                }
                catch (error) {
                    console.error("[PinsonBotWS] Failed to parse message:", error);
                    this.emit("error", { type: "parse_error", error });
                }
            });
            this.ws.on("pong", () => {
                this.lastPongTime = Date.now();
            });
            this.ws.on("close", (code, reason) => {
                console.log(`[PinsonBotWS] Disconnected: code=${code}, reason=${reason.toString()}`);
                this.connected = false;
                this.stopHealthCheck();
                this.stopHeartbeat();
                this.emit("disconnected", { code, reason: reason.toString() });
                // Attempt reconnection
                this.scheduleReconnect(code);
            });
            this.ws.on("error", (error) => {
                console.error("[PinsonBotWS] WebSocket error:", error);
                this.emit("error", { type: "websocket_error", error });
            });
        }
        catch (error) {
            console.error("[PinsonBotWS] Failed to create WebSocket:", error);
            this.emit("error", { type: "connection_error", error });
            this.scheduleReconnect(1006);
        }
    }
    /**
     * Disconnect from PinsonBots Platform
     */
    disconnect() {
        console.log("[PinsonBotWS] Manual disconnect requested");
        this.isManualDisconnect = true;
        this.stopHealthCheck();
        this.stopHeartbeat();
        this.stopPlatformRecoveryCheck();
        this.stopBatchSync();
        if (this.ws) {
            this.ws.close(1000, "Client disconnect");
            this.ws = null;
        }
        this.connected = false;
    }
    /**
     * Send a message to the platform
     */
    sendMessage(message) {
        if (!this.connected ||
            !this.ws ||
            this.ws.readyState !== WebSocket.OPEN) {
            // Queue message for later delivery
            console.log("[PinsonBotWS] Queueing message (not connected)");
            this.messageQueue.push({
                message,
                timestamp: Date.now(),
                retryCount: 0,
            });
            return false;
        }
        try {
            this.ws.send(JSON.stringify(message));
            console.log("[PinsonBotWS] Message sent:", message.type);
            return true;
        }
        catch (error) {
            console.error("[PinsonBotWS] Failed to send message:", error);
            this.emit("error", { type: "send_error", error, message });
            return false;
        }
    }
    /**
     * Send assistant response
     */
    sendAssistantResponse(content, sessionId, conversationId) {
        // Store assistant message in history
        this.storeMessage(sessionId, "assistant", content);
        const data = {
            content,
            session_id: sessionId,
            role: "assistant",
            lobster_id: this.lobsterId,
        };
        if (conversationId !== undefined) {
            data.conversation_id = conversationId;
            console.log(`[PinsonBotWS] sendAssistantResponse: conversation_id=${conversationId}, contentLength=${content?.length || 0}`);
        }
        else {
            console.warn(`[PinsonBotWS] sendAssistantResponse: NO conversation_id! contentLength=${content?.length || 0}`);
        }
        return this.sendMessage({
            type: "bot_response",
            data,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Send assistant response with media (ACP standard)
     * Supports images, audio, video attachments
     */
    sendAssistantResponseWithMedia(content, sessionId, media, conversationId) {
        // Store assistant message in history
        this.storeMessage(sessionId, "assistant", content);
        const data = {
            content,
            session_id: sessionId,
            role: "assistant",
            lobster_id: this.lobsterId,
        };
        // Add media attachments (ACP standard)
        if (media.images?.length) {
            data.images = media.images;
        }
        if (media.audio?.length) {
            data.audio = media.audio;
        }
        if (media.video?.length) {
            data.video = media.video;
        }
        if (media.attachments?.length) {
            data.attachments = media.attachments;
        }
        if (conversationId !== undefined) {
            data.conversation_id = conversationId;
        }
        console.log(`[PinsonBotWS] sendAssistantResponseWithMedia: images=${media.images?.length || 0}, audio=${media.audio?.length || 0}, video=${media.video?.length || 0}`);
        return this.sendMessage({
            type: "bot_response",
            data,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Send image response (helper method)
     */
    sendImageResponse(content, sessionId, images, conversationId) {
        return this.sendAssistantResponseWithMedia(content, sessionId, { images }, conversationId);
    }
    /**
     * Send media response via URL
     * 用于发送图片、音频、视频等媒体文件
     */
    sendMediaResponse(mediaUrl, mediaType, sessionId, conversationId) {
        const data = {
            content: "",
            media_url: mediaUrl,
            media_type: mediaType, // "image" | "audio" | "video"
            session_id: sessionId,
            role: "assistant",
            lobster_id: this.lobsterId,
        };
        if (conversationId !== undefined) {
            data.conversation_id = conversationId;
        }
        console.log(`[PinsonBotWS] sendMediaResponse: type=${mediaType}, url=${mediaUrl?.substring(0, 50)}...`);
        return this.sendMessage({
            type: "bot_response",
            data,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Send stream token (for real-time streaming from OpenClaw)
     */
    sendStreamToken(token, sessionId) {
        return this.sendMessage({
            type: "stream_token",
            data: {
                token,
                session_id: sessionId,
                lobster_id: this.lobsterId,
            },
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Send typing indicator
     */
    sendTypingIndicator(sessionId, isTyping) {
        return this.sendMessage({
            type: isTyping ? "typing_start" : "typing_end",
            data: {
                session_id: sessionId,
                lobster_id: this.lobsterId,
            },
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Send token usage to platform
     * 同步当次会话的 token 使用数据
     */
    sendTokenUsage(sessionId, usage) {
        return this.sendMessage({
            type: "token_usage",
            data: {
                session_id: sessionId,
                lobster_id: this.lobsterId,
                usage,
                timestamp: new Date().toISOString(),
            },
        });
    }
    /**
     * Send API call stats to platform
     * 同步当次会话的 API 调用次数（用于不支持 token usage 的模型）
     */
    sendApiCall(sessionId, stats) {
        return this.sendMessage({
            type: "api_call",
            data: {
                session_id: sessionId,
                lobster_id: this.lobsterId,
                stats,
                timestamp: new Date().toISOString(),
            },
        });
    }
    /**
     * Request conversation history
     */
    requestHistory(sessionId) {
        return this.sendMessage({
            type: "history_request",
            data: {
                session_id: sessionId,
            },
        });
    }
    /**
     * Send connection status update
     */
    sendStatusUpdate(status) {
        return this.sendMessage({
            type: "status",
            data: {
                status,
                timestamp: new Date().toISOString(),
            },
        });
    }
    /**
     * Check if currently connected
     */
    isConnected() {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }
    /**
     * Send metadata to PinsonBots Platform
     * Called after connection is established
     */
    sendMetadata() {
        try {
            const metadata = collectMetadata();
            const message = createMetadataMessage(metadata);
            console.log(`[PinsonBotWS] Sending metadata: ${JSON.stringify(metadata).substring(0, 200)}...`);
            return this.sendMessage(message);
        }
        catch (error) {
            console.error("[PinsonBotWS] Failed to send metadata:", error);
            return false;
        }
    }
    /**
     * Store message in conversation history and sync to platform
     */
    storeMessage(sessionId, role, content, conversationId) {
        if (!this.conversationHistory.has(sessionId)) {
            this.conversationHistory.set(sessionId, []);
        }
        const history = this.conversationHistory.get(sessionId);
        const msg = {
            role,
            content,
            timestamp: new Date().toISOString(),
            conversation_id: conversationId,
        };
        history.push(msg);
        // Limit history length
        if (history.length > this.maxHistoryLength) {
            history.shift();
        }
        // Sync to platform if enabled
        if (this.historySyncConfig.enabled) {
            if (this.historySyncConfig.mode === "realtime") {
                // Real-time sync: send immediately
                this.pushHistoryToPlatform(sessionId, [msg]);
            }
            else {
                // Batch sync: add to pending queue
                this.addToPendingSync(sessionId, msg);
            }
        }
    }
    /**
     * Add message to pending sync queue (for batch mode)
     */
    addToPendingSync(sessionId, msg) {
        if (!this.pendingSync.has(sessionId)) {
            this.pendingSync.set(sessionId, {
                sessionId,
                messages: [],
                lastSync: Date.now(),
            });
        }
        const pending = this.pendingSync.get(sessionId);
        pending.messages.push(msg);
        // Limit pending size
        if (pending.messages.length > (this.historySyncConfig.maxCacheSize || 1000)) {
            pending.messages.shift();
        }
    }
    /**
     * Push history to platform
     */
    pushHistoryToPlatform(sessionId, messages) {
        if (!this.connected) {
            console.log("[PinsonBotWS] Cannot push history: not connected");
            return false;
        }
        const success = this.sendMessage({
            type: "history_sync",
            data: {
                session_id: sessionId,
                lobster_id: this.lobsterId,
                messages,
                timestamp: new Date().toISOString(),
            },
        });
        if (success) {
            this.emit("history_sync", { sessionId, success: true, count: messages.length });
        }
        return success;
    }
    /**
     * Start batch sync timer
     */
    startBatchSync() {
        if (this.batchSyncInterval) {
            this.stopBatchSync();
        }
        const interval = this.historySyncConfig.batchIntervalMs || 5000;
        this.batchSyncInterval = setInterval(() => {
            this.flushPendingSync();
        }, interval);
        console.log(`[PinsonBotWS] Batch sync started (interval: ${interval}ms)`);
    }
    /**
     * Stop batch sync timer
     */
    stopBatchSync() {
        if (this.batchSyncInterval) {
            // Flush remaining before stopping
            this.flushPendingSync();
            clearInterval(this.batchSyncInterval);
            this.batchSyncInterval = undefined;
            console.log("[PinsonBotWS] Batch sync stopped");
        }
    }
    /**
     * Flush pending sync messages to platform
     */
    flushPendingSync() {
        if (!this.connected || this.pendingSync.size === 0) {
            return;
        }
        for (const [sessionId, pending] of this.pendingSync) {
            if (pending.messages.length > 0) {
                const success = this.pushHistoryToPlatform(sessionId, pending.messages);
                if (success) {
                    pending.messages = [];
                    pending.lastSync = Date.now();
                }
            }
        }
    }
    /**
     * Import history from platform (for recovery)
     */
    importHistory(sessionId, messages) {
        if (messages && messages.length > 0) {
            this.conversationHistory.set(sessionId, messages);
            console.log(`[PinsonBotWS] Imported ${messages.length} messages for session ${sessionId}`);
        }
    }
    /**
     * Handle history request from platform
     */
    handleHistoryRequest(data) {
        const { session_id, limit = 20 } = data;
        const history = this.conversationHistory.get(session_id) || [];
        // Get last N messages
        const messages = history.slice(-limit);
        // Send history response
        this.sendMessage({
            type: "history_response",
            data: {
                session_id,
                lobster_id: this.lobsterId,
                messages,
                total: history.length,
            },
            timestamp: new Date().toISOString(),
        });
        console.log(`[PinsonBotWS] Sent history_response: ${messages.length} messages for session ${session_id}`);
    }
    /**
     * Get conversation history for a session
     */
    getHistory(sessionId, limit) {
        const history = this.conversationHistory.get(sessionId) || [];
        return limit ? history.slice(-limit) : [...history];
    }
    /**
     * Get all conversation histories
     */
    getAllHistories() {
        return new Map(this.conversationHistory);
    }
    /**
     * Clear conversation history for a session
     */
    clearHistory(sessionId) {
        if (sessionId) {
            this.conversationHistory.delete(sessionId);
            this.pendingSync.delete(sessionId);
        }
        else {
            this.conversationHistory.clear();
            this.pendingSync.clear();
        }
    }
    /**
     * Handle incoming messages
     */
    handleMessage(message) {
        console.log(`[PinsonBotWS] Received message: type=${message.type}, sessionId=${message.data?.session_id?.substring(0, 30)}`);
        switch (message.type) {
            case "connected":
                console.log("[PinsonBotWS] Server confirmed connection");
                break;
            case "heartbeat_ack":
                // Heartbeat acknowledgment
                this.lastHeartbeatAck = Date.now();
                this.heartbeatStats.acked++;
                this.heartbeatStats.lastSuccessTime = Date.now();
                this.consecutiveHeartbeatFailures = 0;
                const latency = this.lastHeartbeatSent ? Date.now() - this.lastHeartbeatSent : 0;
                console.log(`[PinsonBotWS] Heartbeat ACK received (latency: ${latency}ms, total: ${this.heartbeatStats.acked})`);
                // Clear timeout timer
                if (this.heartbeatTimeout) {
                    clearTimeout(this.heartbeatTimeout);
                    this.heartbeatTimeout = undefined;
                }
                break;
            case "message":
            case "user_message":
                // User message from platform
                // Handle nested message structure: message.data.data.content
                const innerData = message.data?.data || message.data;
                const content = innerData?.content || innerData?.text || "";
                const sessionId = innerData?.session_id || innerData?.sessionId || message.data?.session_id || "";
                const conversationId = innerData?.conversation_id || innerData?.conversationId || message.data?.conversation_id;
                // Extract user role information from message or parse from session_id
                // Session ID formats:
                // - New: pinsonbot:{lobster_id}:{user_role}:{user_id}[:group:...]
                // - Old: pinsonbot:{lobster_id}:group:{group_id}:{session_type}:{extra_id}
                // - Old: pinsonbot:{lobster_id}:default
                // user_role 只有两种：owner | guest
                let userId = innerData?.user_id || innerData?.userId || "";
                let userRole = innerData?.user_role || innerData?.userRole || "";
                // If user_id/user_role not provided, parse from session_id
                if ((!userId || !userRole) && sessionId.startsWith('pinsonbot:')) {
                    const parts = sessionId.split(':');
                    if (parts.length >= 4) {
                        // Check if it's old group format: pinsonbot:lobster_id:group:...
                        if (parts[2] === 'group') {
                            // Old format: no user_role info, use fallback
                            // For backward compatibility, treat as admin (owner)
                            userRole = userRole || "owner";
                            // userId might be in parts[5] if format is :group:X:user:USER_ID
                            if (parts[4] === 'user' && parts[5]) {
                                userId = userId || parts[5];
                            }
                            else if (parts[4] === 'member' && parts[5]) {
                                userId = userId || parts[5];
                            }
                        }
                        else if (parts[2] === 'default') {
                            // Old single chat format: pinsonbot:lobster_id:default
                            userRole = userRole || "owner";
                        }
                        else {
                            // New format: pinsonbot:lobster_id:user_role:user_id[:group:...]
                            // user_role: owner | guest
                            userRole = userRole || parts[2] || "guest";
                            userId = userId || parts[3] || "";
                        }
                    }
                }
                // Extract media attachments (ACP standard)
                const images = innerData?.images || undefined;
                const audio = innerData?.audio || undefined;
                const video = innerData?.video || undefined;
                const attachments = innerData?.attachments || undefined;
                // Log media info if present
                if (images?.length) {
                    console.log(`[PinsonBotWS] Received ${images.length} image(s) with message`);
                }
                if (audio?.length) {
                    console.log(`[PinsonBotWS] Received ${audio.length} audio file(s) with message`);
                }
                if (video?.length) {
                    console.log(`[PinsonBotWS] Received ${video.length} video(s) with message`);
                }
                if (attachments?.length) {
                    console.log(`[PinsonBotWS] Received ${attachments.length} attachment(s) with message`);
                }
                console.log(`[PinsonBotWS] Emitting user_message: content="${content?.substring(0, 50)}", sessionId="${sessionId}", userId="${userId}", userRole="${userRole}"`);
                // Store user message in history
                this.storeMessage(sessionId, "user", content);
                this.emit("user_message", {
                    content,
                    sessionId,
                    conversationId,
                    userId,
                    userRole,
                    timestamp: message.timestamp,
                    // Media attachments (ACP standard)
                    images,
                    audio,
                    video,
                    attachments,
                });
                break;
            case "history":
                // Conversation history response
                this.emit("history", {
                    sessionId: message.data.session_id,
                    messages: message.data.messages,
                });
                break;
            case "history_request":
                // Platform requests conversation history
                console.log(`[PinsonBotWS] History request for session: ${message.data?.session_id}`);
                this.handleHistoryRequest(message.data);
                break;
            case "history_import":
                // Platform sends history for import (e.g., after restart)
                if (message.data?.session_id && message.data?.messages) {
                    this.importHistory(message.data.session_id, message.data.messages);
                    console.log(`[PinsonBotWS] Imported history for session: ${message.data.session_id}`);
                }
                break;
            case "history_sync_ack":
                // Platform acknowledged history sync
                console.log(`[PinsonBotWS] History sync acknowledged: ${message.data?.session_id}`);
                break;
            case "error":
                // Error from server
                console.error("[PinsonBotWS] Server error:", message.data);
                this.emit("server_error", message.data);
                break;
            default:
                console.warn("[PinsonBotWS] Unknown message type:", message.type);
                this.emit("unknown_message", message);
        }
    }
    /**
     * Schedule reconnection after disconnection
     */
    scheduleReconnect(closeCode) {
        // 如果是手动断开，不重连
        if (this.isManualDisconnect) {
            console.log("[PinsonBotWS] Manual disconnect, skipping reconnect");
            return;
        }
        // 如果超过最大重连次数，启动周期性平台恢复检测
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.warn("[PinsonBotWS] Max reconnection attempts reached, starting platform recovery check");
            this.emit("max_reconnect_attempts_reached", {
                attempts: this.reconnectAttempts,
            });
            this.startPlatformRecoveryCheck();
            return;
        }
        // 指数退避重连，但最大延迟不超过 5 分钟
        const delay = Math.min(this.reconnectDelay * Math.pow(this.reconnectBackoff, this.reconnectAttempts), 5 * 60 * 1000);
        this.reconnectAttempts++;
        console.log(`[PinsonBotWS] Scheduling reconnect in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts === Infinity ? '∞' : this.maxReconnectAttempts})`);
        setTimeout(() => {
            console.log("[PinsonBotWS] Attempting reconnection...");
            this.connect();
        }, delay);
    }
    /**
     * Start periodic platform recovery check
     * 当达到最大重连次数后，定期检测平台是否恢复
     */
    startPlatformRecoveryCheck() {
        if (this.platformRecoveryInterval) {
            return; // 已经在检测中
        }
        console.log("[PinsonBotWS] Starting platform recovery check (every 60s)");
        this.platformRecoveryInterval = setInterval(async () => {
            if (this.isConnected()) {
                this.stopPlatformRecoveryCheck();
                return;
            }
            console.log("[PinsonBotWS] Checking if platform is available...");
            try {
                // 尝试连接
                this.reconnectAttempts = 0; // 重置重连计数
                this.connect();
            }
            catch (error) {
                console.error("[PinsonBotWS] Platform recovery check failed:", error);
            }
        }, 60000); // 每 60 秒检测一次
    }
    /**
     * Stop platform recovery check
     */
    stopPlatformRecoveryCheck() {
        if (this.platformRecoveryInterval) {
            clearInterval(this.platformRecoveryInterval);
            this.platformRecoveryInterval = undefined;
            console.log("[PinsonBotWS] Platform recovery check stopped");
        }
    }
    /**
     * Process queued messages
     */
    processMessageQueue() {
        while (this.messageQueue.length > 0 && this.isConnected()) {
            const queued = this.messageQueue.shift();
            if (!this.sendMessage(queued.message)) {
                // Failed to send, put back in queue
                this.messageQueue.unshift(queued);
                break;
            }
        }
    }
    /**
     * Start health check monitoring
     */
    startHealthCheck() {
        if (this.healthCheckInterval) {
            this.stopHealthCheck();
        }
        // Send ping every 30 seconds
        this.healthCheckInterval = setInterval(() => {
            if (!this.isConnected()) {
                this.stopHealthCheck();
                return;
            }
            // Check if we received a pong recently
            if (this.lastPongTime && Date.now() - this.lastPongTime > 60000) {
                console.warn("[PinsonBotWS] No pong received in 60s, connection may be stale");
            }
            // Send ping
            try {
                this.ws.ping();
            }
            catch (error) {
                console.error("[PinsonBotWS] Ping failed:", error);
            }
        }, 30000);
    }
    /**
     * Stop health check monitoring
     */
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
    }
    // ==================== Application Heartbeat ====================
    /**
     * Start application-level heartbeat
     */
    startHeartbeat() {
        if (this.heartbeatInterval) {
            this.stopHeartbeat();
        }
        console.log(`[PinsonBotWS] Starting application heartbeat (interval: ${this.heartbeatIntervalMs}ms, timeout: ${this.heartbeatTimeoutMs}ms)`);
        this.heartbeatInterval = setInterval(() => {
            if (!this.isConnected()) {
                this.stopHeartbeat();
                return;
            }
            // Check for timeout
            if (this.heartbeatTimeout) {
                this.consecutiveHeartbeatFailures++;
                this.heartbeatStats.failed++;
                this.heartbeatStats.lastFailTime = Date.now();
                console.warn(`[PinsonBotWS] Heartbeat timeout! Consecutive failures: ${this.consecutiveHeartbeatFailures}/${this.maxHeartbeatFailures}`);
                clearTimeout(this.heartbeatTimeout);
                this.heartbeatTimeout = undefined;
                // Trigger reconnect if max failures reached
                if (this.consecutiveHeartbeatFailures >= this.maxHeartbeatFailures) {
                    console.error(`[PinsonBotWS] Max heartbeat failures reached, triggering reconnection`);
                    this.emit("heartbeat_failed", {
                        consecutiveFailures: this.consecutiveHeartbeatFailures,
                        stats: this.heartbeatStats,
                    });
                    if (this.ws) {
                        this.ws.close(1001, "Heartbeat timeout");
                    }
                    return;
                }
            }
            // Send heartbeat
            this.sendHeartbeat();
        }, this.heartbeatIntervalMs);
    }
    /**
     * Stop application-level heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }
        if (this.heartbeatTimeout) {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = undefined;
        }
        console.log("[PinsonBotWS] Application heartbeat stopped");
    }
    /**
     * Send heartbeat with updated metadata
     */
    sendHeartbeat() {
        try {
            const metadata = collectMetadata();
            const message = createHeartbeatMessage(metadata);
            this.lastHeartbeatSent = Date.now();
            this.heartbeatStats.sent++;
            // Set timeout timer
            if (this.heartbeatTimeout) {
                clearTimeout(this.heartbeatTimeout);
            }
            this.heartbeatTimeout = setTimeout(() => {
                console.log("[PinsonBotWS] Heartbeat timeout timer triggered");
            }, this.heartbeatTimeoutMs);
            const result = this.sendMessage(message);
            if (result) {
                console.log(`[PinsonBotWS] Heartbeat sent (total: ${this.heartbeatStats.sent})`);
            }
            return result;
        }
        catch (error) {
            console.error("[PinsonBotWS] Failed to send heartbeat:", error);
            return false;
        }
    }
    /**
     * Get heartbeat statistics
     */
    getHeartbeatStats() {
        const successRate = this.heartbeatStats.sent > 0
            ? (this.heartbeatStats.acked / this.heartbeatStats.sent) * 100
            : 100;
        return {
            ...this.heartbeatStats,
            successRate,
            consecutiveFailures: this.consecutiveHeartbeatFailures,
        };
    }
    /**
     * Reset heartbeat statistics
     */
    resetHeartbeatStats() {
        this.heartbeatStats = { sent: 0, acked: 0, failed: 0 };
        this.consecutiveHeartbeatFailures = 0;
        this.lastHeartbeatSent = undefined;
        this.lastHeartbeatAck = undefined;
    }
    /**
     * Get enhanced connection statistics
     */
    getStats() {
        return {
            connected: this.isConnected(),
            lobsterId: this.lobsterId,
            queueLength: this.messageQueue.length,
            reconnectAttempts: this.reconnectAttempts,
            historySessions: this.conversationHistory.size,
            heartbeat: this.getHeartbeatStats(),
        };
    }
}
//# sourceMappingURL=ws-client.js.map