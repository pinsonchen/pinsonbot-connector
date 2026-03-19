const DEFAULT_ACCOUNT_ID = "default";
/**
 * Merge channel-level defaults into an account-specific config.
 */
export function mergeAccountWithDefaults(channelCfg, accountCfg) {
    const { accounts: _accounts, ...defaults } = channelCfg;
    return {
        ...defaults,
        accounts: { [DEFAULT_ACCOUNT_ID]: accountCfg },
    };
}
/**
 * Resolve PinsonBot config for a specific account.
 */
export function getConfig(cfg, accountId) {
    const raw = cfg?.channels?.pinsonbot;
    if (!raw) {
        return { accounts: {} };
    }
    if (accountId &&
        accountId !== DEFAULT_ACCOUNT_ID &&
        raw.accounts?.[accountId]) {
        return mergeAccountWithDefaults(raw, raw.accounts[accountId]);
    }
    return raw;
}
/**
 * Check whether the config contains required credentials.
 */
export function isConfigured(cfg, accountId) {
    const config = getConfig(cfg, accountId);
    const accounts = config.accounts || {};
    return Object.values(accounts).some((acc) => acc.lobsterId && acc.internalToken);
}
/**
 * List all account IDs present in the config.
 */
export function listAccountIds(cfg) {
    const raw = cfg?.channels?.pinsonbot;
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
export function resolveAccount(cfg, accountId) {
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
//# sourceMappingURL=config.js.map