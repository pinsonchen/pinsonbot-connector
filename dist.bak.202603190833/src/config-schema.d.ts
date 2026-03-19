import { z } from "zod";
/**
 * PinsonBot configuration schema using Zod.
 */
export declare const PinsonBotConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    endpoint: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    accounts: z.ZodRecord<z.ZodString, z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        lobsterId: z.ZodString;
        internalToken: z.ZodString;
    }, z.core.$strip>>;
    retry: z.ZodOptional<z.ZodObject<{
        maxAttempts: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        delayMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        backoffMultiplier: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
    healthCheck: z.ZodOptional<z.ZodObject<{
        enabled: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        intervalMs: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type PinsonBotConfigSchemaType = z.infer<typeof PinsonBotConfigSchema>;
//# sourceMappingURL=config-schema.d.ts.map