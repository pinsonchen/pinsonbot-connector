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

import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream';
import { mkdir, rm, rename } from 'fs/promises';

const execAsync = promisify(exec);
const pipelineAsync = promisify(pipeline);

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

export class PluginUpdater {
  private readonly githubRepo: string;
  private readonly pinsonbotEndpoint: string;
  private readonly pluginName: string;
  private readonly projectRoot: string;
  private readonly versionFilePath: string;
  private checkInterval?: NodeJS.Timeout;
  private isUpdating: boolean = false;
  private notifyCallback?: (message: string) => void;
  private autoInstallEnabled: boolean = false;

  constructor(
    projectRoot: string,
    options: UpdateOptions = {}
  ) {
    this.githubRepo = options.githubRepo || 'pinsonchen/pinsonbot-connector';
    this.pinsonbotEndpoint = options.pinsonbotEndpoint || 
      process.env.PINSONBOT_UPDATE_ENDPOINT || 
      'https://tools.pinsonbot.com/pinsonbots';
    this.pluginName = 'pinsonbot-connector';
    this.projectRoot = projectRoot;
    this.versionFilePath = join(projectRoot, '.last-checked-version');
  }

  setNotifyCallback(callback: (message: string) => void): void {
    this.notifyCallback = callback;
  }

  setAutoInstall(enabled: boolean): void {
    this.autoInstallEnabled = enabled;
    this.notify(`Auto-install ${enabled ? 'enabled' : 'disabled'}`);
  }

  private notify(message: string): void {
    console.log(`[Updater] ${message}`);
    if (this.notifyCallback) {
      this.notifyCallback(message);
    }
  }

  getCurrentVersion(): string {
    try {
      const packagePath = join(this.projectRoot, 'package.json');
      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
      return packageJson.version || '0.0.0';
    } catch (error) {
      console.error('[Updater] Failed to read current version:', error);
      return '0.0.0';
    }
  }

  /**
   * Fetch from PinsonBots Platform (国内直连)
   */
  private async fetchFromPinsonBots(): Promise<ReleaseInfo | null> {
    try {
      const url = `${this.pinsonbotEndpoint}/plugins/${this.pluginName}/releases/latest`;
      const { stdout } = await execAsync(`curl -s --connect-timeout 5 "${url}"`);
      
      if (!stdout || stdout.includes('404') || stdout.includes('error')) {
        return null;
      }
      
      const data = JSON.parse(stdout);
      return {
        version: data.version,
        name: data.name,
        published_at: data.published_at,
        body: data.body || '',
        // download_url is relative, build full URL
        download_url: `https://tools.pinsonbot.com${data.download_url}`,
        size: data.size,
        checksum: data.checksum,
        format: 'tar.gz' as const  // PinsonBots always uses tar.gz
      };
    } catch (error) {
      console.warn('[Updater] PinsonBots unavailable:', (error as Error).message);
      return null;
    }
  }

  /**
   * Fetch from GitHub (需要代理)
   */
  private async fetchFromGitHub(): Promise<ReleaseInfo | null> {
    try {
      const proxyEnv = process.env.https_proxy || process.env.HTTPS_PROXY || '';
      const curlCmd = proxyEnv
        ? `curl -x "${proxyEnv}" -s https://api.github.com/repos/${this.githubRepo}/releases/latest`
        : `curl -s https://api.github.com/repos/${this.githubRepo}/releases/latest`;
      
      const { stdout } = await execAsync(curlCmd);
      
      if (!stdout || stdout.includes('rate limit')) {
        return this.getCachedVersion();
      }
      
      const data = JSON.parse(stdout);
      if (!data.tag_name) {
        return this.getCachedVersion();
      }
      
      const version = data.tag_name.replace(/^v/, '');
      return {
        version,
        name: data.name,
        published_at: data.published_at,
        body: data.body || '',
        download_url: `https://github.com/${this.githubRepo}/archive/refs/tags/v${version}.zip`,
        html_url: data.html_url,
        format: 'zip' as const  // GitHub uses zip
      };
    } catch (error) {
      console.error('[Updater] GitHub fetch failed:', (error as Error).message);
      return this.getCachedVersion();
    }
  }

  /**
   * Fetch latest release (PinsonBots first, GitHub fallback)
   */
  async fetchLatestRelease(): Promise<{ release: ReleaseInfo | null; source: 'pinsonbots' | 'github' | undefined }> {
    // 1. Try PinsonBots (国内直连)
    const pinsonbots = await this.fetchFromPinsonBots();
    if (pinsonbots) {
      return { release: pinsonbots, source: 'pinsonbots' };
    }
    
    // 2. Fallback to GitHub
    this.notify('📍 PinsonBots unavailable, using GitHub');
    const github = await this.fetchFromGitHub();
    return { release: github, source: github ? 'github' : undefined };
  }

  private getCachedVersion(): ReleaseInfo | null {
    try {
      if (existsSync(this.versionFilePath)) {
        const data = JSON.parse(readFileSync(this.versionFilePath, 'utf-8'));
        return data;
      }
    } catch (error) {
      console.error('[Updater] Failed to read cached version:', error);
    }
    return null;
  }

  private cacheVersion(release: ReleaseInfo): void {
    try {
      writeFileSync(this.versionFilePath, JSON.stringify(release, null, 2));
    } catch (error) {
      console.error('[Updater] Failed to cache version:', error);
    }
  }

  async checkForUpdate(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();
    const { release, source } = await this.fetchLatestRelease();
    
    if (!release) {
      return {
        currentVersion,
        latestVersion: '0.0.0',
        hasUpdate: false
      };
    }
    
    const latestVersion = release.version;
    const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;
    
    if (hasUpdate) {
      this.cacheVersion(release);
    }
    
    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseInfo: release,
      source: source || undefined
    };
  }

  private compareVersions(v1: string, v2: string): number {
    if (!v1 || !v2) return 0;
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  async installUpdate(release: ReleaseInfo): Promise<boolean> {
    if (this.isUpdating) {
      this.notify('Update already in progress');
      return false;
    }
    
    this.isUpdating = true;
    const version = release.version;
    const backupDir = join(this.projectRoot, `.backup-${Date.now()}`);
    const tempDir = join(this.projectRoot, `.update-${version}`);
    
    try {
      this.notify(`Starting update to v${version}...`);
      
      // Create backup
      await this.createBackup(backupDir);
      
      // Download - determine format from release info
      this.notify('Downloading update...');
      const isTarGz = release.format === 'tar.gz' || release.download_url.endsWith('.tar.gz');
      const archivePath = join(this.projectRoot, `update-${version}.${isTarGz ? 'tar.gz' : 'zip'}`);
      await this.downloadFile(release.download_url, archivePath);
      
      // Extract
      this.notify('Extracting update...');
      await mkdir(tempDir, { recursive: true });
      if (isTarGz) {
        await execAsync(`tar -xzf "${archivePath}" -C "${tempDir}"`);
      } else {
        await execAsync(`unzip -o "${archivePath}" -d "${tempDir}"`);
      }
      
      // Copy files
      this.notify('Installing update...');
      let extractedDir = join(tempDir, `${this.pluginName}-${version}`);
      if (!existsSync(extractedDir)) {
        extractedDir = join(tempDir, `${this.pluginName}-v${version}`);
      }
      if (!existsSync(extractedDir)) {
        extractedDir = join(tempDir, this.pluginName);
      }
      if (!existsSync(extractedDir)) {
        // Check if tar.gz extracted directly to tempDir
        const srcInTemp = join(tempDir, 'src');
        const pkgInTemp = join(tempDir, 'package.json');
        if (existsSync(srcInTemp) && existsSync(pkgInTemp)) {
          extractedDir = tempDir;
        }
      }
      if (!existsSync(extractedDir)) {
        throw new Error('Could not find extracted plugin directory');
      }
      await execAsync(`cp -r "${extractedDir}/"* "${this.projectRoot}/"`);
      
      // Install dependencies
      this.notify('Installing dependencies...');
      await this.installDependencies();
      
      // Build TypeScript
      this.notify('Building TypeScript...');
      await this.buildTypeScript();
      
      // Cleanup
      await this.cleanup(archivePath, tempDir);
      
      this.notify(`✅ Update to v${version} completed successfully!`);
      this.notify('🔄 Please restart OpenClaw Gateway to apply the update.');
      
      return true;
    } catch (error: any) {
      this.notify(`❌ Update failed: ${error.message}`);
      this.notify('Rolling back to previous version...');
      await this.rollback(backupDir);
      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  private async createBackup(backupDir: string): Promise<void> {
    await mkdir(backupDir, { recursive: true });
    
    const srcDir = join(this.projectRoot, 'src');
    if (existsSync(srcDir)) {
      await mkdir(join(backupDir, 'src'), { recursive: true });
      await execAsync(`cp -r "${srcDir}/"* "${backupDir}/src/"`);
    }
    
    const distDir = join(this.projectRoot, 'dist');
    if (existsSync(distDir)) {
      await mkdir(join(backupDir, 'dist'), { recursive: true });
      await execAsync(`cp -r "${distDir}/"* "${backupDir}/dist/"`);
    }
    
    const packageJson = join(this.projectRoot, 'package.json');
    if (existsSync(packageJson)) {
      await execAsync(`cp "${packageJson}" "${backupDir}/package.json"`);
    }
    
    this.notify(`Backup created at: ${backupDir}`);
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const proxyEnv = process.env.https_proxy || process.env.HTTPS_PROXY || '';
    const curlCmd = proxyEnv
      ? `curl -x "${proxyEnv}" -L -s -o "${destPath}" "${url}"`
      : `curl -L -s -o "${destPath}" "${url}"`;
    
    await execAsync(curlCmd);
    
    if (!existsSync(destPath)) {
      throw new Error('Download failed: file not created');
    }
    
    const { stdout } = await execAsync(`stat -c%s "${destPath}" 2>/dev/null || echo 0`);
    const size = parseInt(stdout.trim());
    if (size === 0) {
      throw new Error('Download failed: empty file');
    }
  }

  private async installDependencies(): Promise<void> {
    await execAsync('npm install --production', { cwd: this.projectRoot });
  }

  private async buildTypeScript(): Promise<void> {
    await execAsync('npm run build', { cwd: this.projectRoot });
  }

  private async cleanup(archivePath: string, tempDir: string): Promise<void> {
    if (existsSync(archivePath)) {
      await rm(archivePath);
    }
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true });
    }
  }

  private async rollback(backupDir: string): Promise<void> {
    try {
      const srcBackup = join(backupDir, 'src');
      if (existsSync(srcBackup)) {
        await execAsync(`cp -r "${srcBackup}/"* "${this.projectRoot}/src/"`);
      }
      
      const distBackup = join(backupDir, 'dist');
      if (existsSync(distBackup)) {
        await execAsync(`cp -r "${distBackup}/"* "${this.projectRoot}/dist/"`);
      }
      
      const packageBackup = join(backupDir, 'package.json');
      if (existsSync(packageBackup)) {
        await execAsync(`cp "${packageBackup}" "${this.projectRoot}/package.json"`);
      }
      
      this.notify('✅ Rollback completed');
    } catch (error: any) {
      this.notify(`❌ Rollback failed: ${error.message}`);
    }
  }

  startPeriodicCheck(intervalMs: number = 6 * 60 * 60 * 1000): void {
    this.stopPeriodicCheck();
    this.notify(`Starting periodic update check (every ${intervalMs / 1000 / 60} minutes)`);
    
    this.checkInterval = setInterval(async () => {
      await this.checkAndNotify();
    }, intervalMs);
    
    this.checkAndNotify();
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  async checkAndNotify(): Promise<UpdateInfo> {
    try {
      const updateInfo = await this.checkForUpdate();
      
      if (updateInfo.hasUpdate && updateInfo.releaseInfo) {
        this.notify(`🆕 Update available: v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`);
        this.notify(`📝 Release: ${updateInfo.releaseInfo.name}`);
        
        if (updateInfo.source) {
          this.notify(`📍 Source: ${updateInfo.source}`);
        }
        
        const changelog = updateInfo.releaseInfo.body.split('\n').slice(0, 5).join('\n');
        if (changelog) {
          this.notify(`📋 Changes:\n${changelog}`);
        }
        
        if (this.autoInstallEnabled) {
          this.notify('🔄 Auto-install enabled, starting update...');
          const success = await this.installUpdate(updateInfo.releaseInfo);
          if (success) {
            this.notify('✅ Auto-update completed! Restart Gateway to apply.');
          }
        }
      } else {
        this.notify('✅ Plugin is up to date');
      }
      
      return updateInfo;
    } catch (error) {
      console.error('[Updater] Check failed:', error);
      return { hasUpdate: false, currentVersion: '0.0.0', latestVersion: '0.0.0' };
    }
  }

  async autoUpdate(): Promise<boolean> {
    const updateInfo = await this.checkForUpdate();
    
    if (updateInfo.hasUpdate && updateInfo.releaseInfo) {
      this.notify(`🆕 Auto-updating to v${updateInfo.latestVersion}...`);
      return await this.installUpdate(updateInfo.releaseInfo);
    }
    
    this.notify('✅ Plugin is up to date');
    return false;
  }
}

// Singleton instance
let updaterInstance: PluginUpdater | null = null;

export function getUpdater(projectRoot?: string, options?: UpdateOptions): PluginUpdater {
  if (!updaterInstance || projectRoot) {
    updaterInstance = new PluginUpdater(
      projectRoot || process.cwd(),
      options
    );
  }
  return updaterInstance;
}