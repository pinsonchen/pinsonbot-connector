import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PinsonBotConfig, PinsonBotAccountConfig } from "./types.js";
/**
 * Merge channel-level defaults into an account-specific config.
 */
export declare function mergeAccountWithDefaults(channelCfg: PinsonBotConfig, accountCfg: PinsonBotAccountConfig): PinsonBotConfig;
/**
 * Resolve PinsonBot config for a specific account.
 */
export declare function getConfig(cfg: OpenClawConfig, accountId?: string): PinsonBotConfig;
/**
 * Check whether the config contains required credentials.
 */
export declare function isConfigured(cfg: OpenClawConfig, accountId?: string): boolean;
/**
 * List all account IDs present in the config.
 */
export declare function listAccountIds(cfg: OpenClawConfig): string[];
/**
 * Resolve a specific account to a full config + metadata.
 */
export declare function resolveAccount(cfg: OpenClawConfig, accountId?: string | null): {
    accountId: string;
    config: PinsonBotConfig;
    enabled: boolean;
    configured: boolean;
    name: string | null;
};
//# sourceMappingURL=config.d.ts.map