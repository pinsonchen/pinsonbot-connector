/**
 * PinsonBot Send Image Skill
 *
 * Registers a tool for AI to send images via PinsonBot Platform
 */
import { Type } from "@sinclair/typebox";
import { activeClients } from "./channel.js";
export function registerSendImageSkill(api) {
    api.registerTool({
        name: "send_image",
        description: "Send an image to the user via PinsonBot Platform. Use this when you want to send an image file to the user.",
        parameters: Type.Object({
            imageUrl: Type.String({
                description: "URL or path of the image to send (e.g., 'https://example.com/image.png' or '/path/to/image.jpg')"
            }),
            caption: Type.Optional(Type.String({
                description: "Optional caption or description for the image"
            })),
            sessionId: Type.Optional(Type.String({
                description: "Session ID to send to (defaults to current session)"
            })),
        }),
        async execute(contextId, params) {
            const { imageUrl, caption, sessionId } = params;
            // Get the active client
            const client = activeClients.get("default");
            if (!client) {
                return {
                    content: [{ type: "text", text: "❌ Error: PinsonBot not connected" }],
                    isError: true
                };
            }
            // Use provided session ID or extract from context
            const targetSessionId = sessionId || contextId;
            try {
                // Send media via WebSocket
                const success = client.sendMediaResponse(imageUrl, "image", targetSessionId);
                const responseText = caption
                    ? `${success ? '✅' : '❌'} ${caption}`
                    : success ? `✅ Image sent: ${imageUrl}` : `❌ Failed to send image`;
                return {
                    content: [{ type: "text", text: responseText }]
                };
            }
            catch (error) {
                return {
                    content: [{ type: "text", text: `❌ Error: ${error.message}` }],
                    isError: true
                };
            }
        },
    }, { optional: true });
    api.logger?.info?.("[PinsonBot] Registered send_image tool");
}
//# sourceMappingURL=send-image-skill.js.map