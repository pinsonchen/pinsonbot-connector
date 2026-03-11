import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { PinsonBotConfig, PinsonBotAccountConfig } from "./types.js";

const DEFAULT_ACCOUNT_ID = "default";

/**
 * Merge channel-level defaults into an account-specific config.
 */
export function mergeAccountWithDefaults(
  channelCfg: PinsonBotConfig,
  accountCfg: PinsonBotAccountConfig
): PinsonBotConfig {
  const { accounts: _accounts, ...defaults } = channelCfg;
  return {
    ...defaults,
    accounts: { [DEFAULT_ACCOUNT_ID]: accountCfg },
  };
}

/**
 * Resolve PinsonBot config for a specific account.
 */
export function getConfig(
  cfg: OpenClawConfig,
  accountId?: string
): PinsonBotConfig {
  const raw = (cfg?.channels as any)?.pinsonbot as PinsonBotConfig | undefined;
  if (!raw) {
    return { accounts: {} } as PinsonBotConfig;
  }
  if (
    accountId &&
    accountId !== DEFAULT_ACCOUNT_ID &&
    raw.accounts?.[accountId]
  ) {
    return mergeAccountWithDefaults(raw, raw.accounts[accountId]);
  }
  return raw;
}

/**
 * Check whether the config contains required credentials.
 */
export function isConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const config = getConfig(cfg, accountId);
  const accounts = config.accounts || {};
  return Object.values(accounts).some(
    (acc: any) => acc.lobsterId && acc.internalToken
  );
}

/**
 * List all account IDs present in the config.
 */
export function listAccountIds(cfg: OpenClawConfig): string[] {
  const raw = (cfg?.channels as any)?.pinsonbot as PinsonBotConfig | undefined;
  if (!raw) {
    return [];
  }
  if (raw.accounts && Object.keys(raw.accounts).length > 0) {
    return Object.keys(raw.accounts);
  }
  return [];
}

/**
 * Resolve a specific account to a full config + metadata.
 */
export function resolveAccount(
  cfg: OpenClawConfig,
  accountId?: string | null
) {
  const id = accountId || DEFAULT_ACCOUNT_ID;
  const config = getConfig(cfg, id);
  const account = config.accounts?.[id];
  const configured = Boolean(account?.lobsterId && account?.internalToken);
  return {
    accountId: id,
    config,
    enabled: account?.enabled !== false && config.enabled !== false,
    configured,
    name: account?.name || null,
  };
}
