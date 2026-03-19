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
import type { PinsonBotChannelPlugin } from "./types.js";
export declare const pinsonbotPlugin: PinsonBotChannelPlugin;
//# sourceMappingURL=channel.d.ts.map