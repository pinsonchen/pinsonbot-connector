/**
 * PinsonBot Connector Auto-Updater v2
 *
 * Features:
 * - Check for updates from PinsonBots Platform (primary) or GitHub (fallback)
 * - Download and install updates automatically
 * - Build TypeScript after update
 * - Notify for restart
 * - Rollback support
 *
 * Update Source Priority:
 * 1. PinsonBots Platform (国内直连，无需代理)
 * 2. GitHub (需要代理或海外访问)
 */
interface ReleaseInfo {
    version: string;
    name: string;
    published_at: string;
    body: string;
    download_url: string;
    html_url?: string;
    size?: number;
    checksum?: string;
    format?: 'tar.gz' | 'zip';
}
interface UpdateInfo {
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    releaseInfo?: ReleaseInfo;
    source?: 'pinsonbots' | 'github';
}
interface UpdateOptions {
    githubRepo?: string;
    pinsonbotEndpoint?: string;
    checkIntervalMs?: number;
    autoInstall?: boolean;
    notifyOnly?: boolean;
}
export declare class PluginUpdater {
    private readonly githubRepo;
    private readonly pinsonbotEndpoint;
    private readonly pluginName;
    private readonly projectRoot;
    private readonly versionFilePath;
    private checkInterval?;
    private isUpdating;
    private notifyCallback?;
    private autoInstallEnabled;
    constructor(projectRoot: string, options?: UpdateOptions);
    setNotifyCallback(callback: (message: string) => void): void;
    setAutoInstall(enabled: boolean): void;
    private notify;
    getCurrentVersion(): string;
    /**
     * Fetch from PinsonBots Platform (国内直连)
     */
    private fetchFromPinsonBots;
    /**
     * Fetch from GitHub (需要代理)
     */
    private fetchFromGitHub;
    /**
     * Fetch latest release (PinsonBots first, GitHub fallback)
     */
    fetchLatestRelease(): Promise<{
        release: ReleaseInfo | null;
        source: 'pinsonbots' | 'github' | undefined;
    }>;
    private getCachedVersion;
    private cacheVersion;
    checkForUpdate(): Promise<UpdateInfo>;
    private compareVersions;
    installUpdate(release: ReleaseInfo): Promise<boolean>;
    private createBackup;
    private downloadFile;
    private installDependencies;
    private buildTypeScript;
    private cleanup;
    private rollback;
    startPeriodicCheck(intervalMs?: number): void;
    stopPeriodicCheck(): void;
    checkAndNotify(): Promise<UpdateInfo>;
    autoUpdate(): Promise<boolean>;
}
export declare function getUpdater(projectRoot?: string, options?: UpdateOptions): PluginUpdater;
export {};
//# sourceMappingURL=updater.d.ts.map