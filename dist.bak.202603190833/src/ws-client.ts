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
import type { PinsonBotMessage } from "./types.js";

interface WSMessage {
  type: string;
  data: any;
  timestamp?: string;
}

interface QueuedMessage {
  message: WSMessage;
  timestamp: number;
  retryCount: number;
}

export class PinsonBotWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private lobsterId: string;
  private internalToken: string;
  private endpoint: string;
  private connected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectDelay: number;
  private reconnectBackoff: number;
  private messageQueue: QueuedMessage[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private lastPongTime?: number;
  private conversationHistory: Map<string, Array<{role: string; content: string; timestamp: string}>> = new Map();
  private maxHistoryLength: number = 100;

  constructor(
    lobsterId: string,
    internalToken: string,
    endpoint: string = "wss://tools.pinsonbot.com/pinsonbots/internal/plugin",
    options: {
      maxReconnectAttempts?: number;
      reconnectDelay?: number;
      reconnectBackoff?: number;
    } = {}
  ) {
    super();

    this.lobsterId = lobsterId;
    this.internalToken = internalToken;
    this.endpoint = endpoint;

    // Connection options
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 5000;
    this.reconnectBackoff = options.reconnectBackoff || 2;

    // Build WebSocket URL with authentication
    const url = new URL(endpoint);
    url.searchParams.append("token", this.internalToken);
    url.searchParams.append("lobster_id", this.lobsterId);
    this.endpoint = url.toString();
  }

  /**
   * Connect to PinsonBots Platform
   */
  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN)
    ) {
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
        this.emit("connected", { lobsterId: this.lobsterId });

        // Start health check
        this.startHealthCheck();

        // Process queued messages
        this.processMessageQueue();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const message: WSMessage = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          console.error("[PinsonBotWS] Failed to parse message:", error);
          this.emit("error", { type: "parse_error", error });
        }
      });

      this.ws.on("pong", () => {
        this.lastPongTime = Date.now();
      });

      this.ws.on("close", (code: number, reason: Buffer) => {
        console.log(
          `[PinsonBotWS] Disconnected: code=${code}, reason=${reason.toString()}`
        );
        this.connected = false;
        this.stopHealthCheck();
        this.emit("disconnected", { code, reason: reason.toString() });

        // Attempt reconnection
        this.scheduleReconnect(code);
      });

      this.ws.on("error", (error: Error) => {
        console.error("[PinsonBotWS] WebSocket error:", error);
        this.emit("error", { type: "websocket_error", error });
      });
    } catch (error) {
      console.error("[PinsonBotWS] Failed to create WebSocket:", error);
      this.emit("error", { type: "connection_error", error });
      this.scheduleReconnect(1006);
    }
  }

  /**
   * Disconnect from PinsonBots Platform
   */
  disconnect(): void {
    console.log("[PinsonBotWS] Manual disconnect requested");
    this.stopHealthCheck();

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.connected = false;
  }

  /**
   * Send a message to the platform
   */
  sendMessage(message: WSMessage): boolean {
    if (
      !this.connected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
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
    } catch (error) {
      console.error("[PinsonBotWS] Failed to send message:", error);
      this.emit("error", { type: "send_error", error, message });
      return false;
    }
  }

  /**
   * Send assistant response
   */
  sendAssistantResponse(content: string, sessionId: string, conversationId?: number): boolean {
    // Store assistant message in history
    this.storeMessage(sessionId, "assistant", content);
    
    const data: any = {
      content,
      session_id: sessionId,
      role: "assistant",
      lobster_id: this.lobsterId,
    };
    if (conversationId !== undefined) {
      data.conversation_id = conversationId;
      console.log(`[PinsonBotWS] sendAssistantResponse: conversation_id=${conversationId}, content=${content.substring(0, 50)}`);
    } else {
      console.warn(`[PinsonBotWS] sendAssistantResponse: NO conversation_id! content=${content.substring(0, 50)}`);
    }
    return this.sendMessage({
      type: "bot_response",
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send stream token (for real-time streaming from OpenClaw)
   */
  sendStreamToken(token: string, sessionId: string): boolean {
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
  sendTypingIndicator(sessionId: string, isTyping: boolean): boolean {
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
   * Request conversation history
   */
  requestHistory(sessionId: string): boolean {
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
  sendStatusUpdate(status: "connected" | "disconnected" | "busy"): boolean {
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
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    connected: boolean;
    lobsterId: string;
    queueLength: number;
    reconnectAttempts: number;
    historySessions: number;
  } {
    return {
      connected: this.isConnected(),
      lobsterId: this.lobsterId,
      queueLength: this.messageQueue.length,
      reconnectAttempts: this.reconnectAttempts,
      historySessions: this.conversationHistory.size,
    };
  }

  /**
   * Store message in conversation history
   */
  private storeMessage(sessionId: string, role: "user" | "assistant", content: string): void {
    if (!this.conversationHistory.has(sessionId)) {
      this.conversationHistory.set(sessionId, []);
    }
    
    const history = this.conversationHistory.get(sessionId)!;
    history.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    
    // Limit history length
    if (history.length > this.maxHistoryLength) {
      history.shift();
    }
  }

  /**
   * Handle history request from platform
   */
  private handleHistoryRequest(data: { session_id: string; limit?: number }): void {
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
  getHistory(sessionId: string, limit?: number): Array<{role: string; content: string; timestamp: string}> {
    const history = this.conversationHistory.get(sessionId) || [];
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Clear conversation history for a session
   */
  clearHistory(sessionId?: string): void {
    if (sessionId) {
      this.conversationHistory.delete(sessionId);
    } else {
      this.conversationHistory.clear();
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: WSMessage): void {
    console.log(`[PinsonBotWS] DEBUG received message: ${JSON.stringify(message)}`);
    
    switch (message.type) {
      case "connected":
        console.log("[PinsonBotWS] Server confirmed connection");
        break;

      case "message":
      case "user_message":
        // User message from platform
        // Handle nested message structure: message.data.data.content
        const innerData = message.data?.data || message.data;
        const content = innerData?.content || innerData?.text || "";
        const sessionId = innerData?.session_id || innerData?.sessionId || message.data?.session_id || "";
        const conversationId = innerData?.conversation_id || innerData?.conversationId || message.data?.conversation_id;
        
        console.log(`[PinsonBotWS] Emitting user_message: content="${content?.substring(0, 50)}", sessionId="${sessionId}"`);
        
        // Store user message in history
        this.storeMessage(sessionId, "user", content);
        
        this.emit("user_message", {
          content,
          sessionId,
          conversationId,
          timestamp: message.timestamp,
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
  private scheduleReconnect(closeCode: number): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[PinsonBotWS] Max reconnection attempts reached");
      this.emit("max_reconnect_attempts_reached", {
        attempts: this.reconnectAttempts,
      });
      return;
    }

    const delay =
      this.reconnectDelay *
      Math.pow(this.reconnectBackoff, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(
      `[PinsonBotWS] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      console.log("[PinsonBotWS] Attempting reconnection...");
      this.connect();
    }, delay);
  }

  /**
   * Process queued messages
   */
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected()) {
      const queued = this.messageQueue.shift()!;

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
  private startHealthCheck(): void {
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
        console.warn(
          "[PinsonBotWS] No pong received in 60s, connection may be stale"
        );
      }

      // Send ping
      try {
        this.ws!.ping();
      } catch (error) {
        console.error("[PinsonBotWS] Ping failed:", error);
      }
    }, 30000);
  }

  /**
   * Stop health check monitoring
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }
}
