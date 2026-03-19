import { z } from "zod";
const PinsonBotAccountConfigSchema = z.object({
    /** Display name for this account */
    name: z.string().optional(),
    /** Whether this account is enabled */
    enabled: z.boolean().optional().default(true),
    /** Lobster ID from PinsonBots Platform */
    lobsterId: z.string(),
    /** Internal token for Plugin WebSocket authentication */
    internalToken: z.string(),
});
/**
 * PinsonBot configuration schema using Zod.
 */
export const PinsonBotConfigSchema = z.object({
    /** Enable/disable PinsonBot channel */
    enabled: z.boolean().optional().default(true),
    /** PinsonBots Platform WebSocket endpoint */
    endpoint: z
        .string()
        .optional()
        .default("wss://tools.pinsonbot.com/pinsonbots/internal/plugin"),
    /** Multi-account configuration */
    accounts: z.record(z.string(), PinsonBotAccountConfigSchema),
    /** Connection retry configuration */
    retry: z
        .object({
        maxAttempts: z.number().int().min(1).optional().default(5),
        delayMs: z.number().int().min(1000).optional().default(5000),
        backoffMultiplier: z.number().min(1).optional().default(2),
    })
        .optional(),
    /** Health check configuration */
    healthCheck: z
        .object({
        enabled: z.boolean().optional().default(true),
        intervalMs: z.number().int().min(1000).optional().default(30000),
    })
        .optional(),
});
//# sourceMappingURL=config-schema.js.map