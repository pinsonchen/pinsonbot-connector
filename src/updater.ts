/**
 * PinsonBot Connector Auto-Updater
 *
 * Features:
 * - Check for updates from GitHub
 * - Download and install updates automatically
 * - Build TypeScript after update
 * - Notify for restart
 * - Rollback support (future)
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream';
import { mkdir, rm, rename } from 'fs/promises';
import * as https from 'https';

const execAsync = promisify(exec);
const pipelineAsync = promisify(pipeline);

interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  body: string;
  html_url: string;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseInfo?: GitHubRelease;
}

interface UpdateOptions {
  githubRepo?: string;
  checkIntervalMs?: number;
  autoInstall?: boolean;
  notifyOnly?: boolean;
}

export class PluginUpdater {
  private readonly githubRepo: string;
  private readonly projectRoot: string;
  private readonly versionFilePath: string;
  private checkInterval?: NodeJS.Timeout;
  private isUpdating: boolean = false;
  private notifyCallback?: (message: string) => void;

  constructor(
    projectRoot: string,
    options: UpdateOptions = {}
  ) {
    this.githubRepo = options.githubRepo || 'pinsonchen/pinsonbot-connector';
    this.projectRoot = projectRoot;
    this.versionFilePath = join(projectRoot, '.last-checked-version');
  }

  /**
   * Set notification callback
   */
  setNotifyCallback(callback: (message: string) => void): void {
    this.notifyCallback = callback;
  }

  /**
   * Notify message via callback or console
   */
  private notify(message: string): void {
    console.log(`[Updater] ${message}`);
    if (this.notifyCallback) {
      this.notifyCallback(message);
    }
  }

  /**
   * Get current version from package.json
   */
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
   * Fetch latest release info from GitHub
   */
  async fetchLatestRelease(): Promise<GitHubRelease | null> {
    try {
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.github.com',
          path: `/repos/${this.githubRepo}/releases/latest`,
          method: 'GET',
          headers: {
            'User-Agent': 'PinsonBot-Connector-Updater',
            'Accept': 'application/vnd.github.v3+json',
          },
        };

        const req = https.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error('Failed to parse GitHub response'));
              }
            } else if (res.statusCode === 403) {
              // Rate limited
              console.warn('[Updater] GitHub API rate limited, using cached version');
              resolve(this.getCachedVersion());
            } else {
              reject(new Error(`GitHub API error: ${res.statusCode}`));
            }
          });
        });

        req.on('error', (e) => {
          console.error('[Updater] Failed to fetch latest release:', e);
          resolve(this.getCachedVersion());
        });

        req.end();
      });
    } catch (error) {
      console.error('[Updater] Exception fetching latest release:', error);
      return this.getCachedVersion();
    }
  }

  /**
   * Get cached version from file
   */
  private getCachedVersion(): GitHubRelease | null {
    try {
      if (existsSync(this.versionFilePath)) {
        const data = readFileSync(this.versionFilePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (e) {
      // Ignore cache errors
    }
    return null;
  }

  /**
   * Cache version to file
   */
  private cacheVersion(release: GitHubRelease): void {
    try {
      writeFileSync(this.versionFilePath, JSON.stringify(release, null, 2));
    } catch (e) {
      console.warn('[Updater] Failed to cache version:', e);
    }
  }

  /**
   * Check for updates
   */
  async checkForUpdate(): Promise<UpdateInfo> {
    const currentVersion = this.getCurrentVersion();
    const latestRelease = await this.fetchLatestRelease();

    if (!latestRelease) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        hasUpdate: false,
      };
    }

    // Cache the release info
    this.cacheVersion(latestRelease);

    const latestVersion = latestRelease.tag_name.replace(/^v/, '');
    const hasUpdate = this.compareVersions(currentVersion, latestVersion) < 0;

    return {
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseInfo: latestRelease,
    };
  }

  /**
   * Compare two version strings
   * Returns: -1 (a < b), 0 (a == b), 1 (a > b)
   */
  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;

      if (aPart < bPart) return -1;
      if (aPart > bPart) return 1;
    }

    return 0;
  }

  /**
   * Download file from URL
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);

      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          this.downloadFile(response.headers.location!, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed: ${response.statusCode}`));
          return;
        }

        pipelineAsync(response, file)
          .then(resolve)
          .catch(reject);
      }).on('error', reject);
    });
  }

  /**
   * Install update from GitHub release
   */
  async installUpdate(release: GitHubRelease): Promise<boolean> {
    if (this.isUpdating) {
      this.notify('Update already in progress');
      return false;
    }

    this.isUpdating = true;

    try {
      const version = release.tag_name.replace(/^v/, '');
      const backupDir = join(this.projectRoot, `.backup-${Date.now()}`);
      const tempDir = join(this.projectRoot, `.update-${version}`);

      this.notify(`Starting update to v${version}...`);

      // Create backup
      this.notify('Creating backup...');
      await this.createBackup(backupDir);

      // Download source code
      this.notify('Downloading update...');
      const zipUrl = `https://github.com/${this.githubRepo}/archive/refs/tags/${release.tag_name}.zip`;
      const zipPath = join(this.projectRoot, `update-${version}.zip`);
      await this.downloadFile(zipUrl, zipPath);

      // Extract and replace files
      this.notify('Extracting update...');
      await this.extractAndUpdate(zipPath, tempDir);

      // Install dependencies
      this.notify('Installing dependencies...');
      await this.installDependencies();

      // Build TypeScript
      this.notify('Building TypeScript...');
      await this.buildTypeScript();

      // Cleanup
      this.notify('Cleaning up...');
      await this.cleanup(zipPath, tempDir);

      this.notify(`✅ Update to v${version} completed successfully!`);
      this.notify('🔄 Please restart OpenClaw Gateway to apply the update.');

      return true;
    } catch (error) {
      console.error('[Updater] Update failed:', error);
      this.notify(`❌ Update failed: ${error}`);

      // Attempt rollback
      await this.rollback();

      return false;
    } finally {
      this.isUpdating = false;
    }
  }

  /**
   * Create backup of current files
   */
  private async createBackup(backupDir: string): Promise<void> {
    const srcDir = join(this.projectRoot, 'src');
    if (existsSync(srcDir)) {
      await execAsync(`cp -r "${srcDir}" "${backupDir}/src"`);
    }

    const distDir = join(this.projectRoot, 'dist');
    if (existsSync(distDir)) {
      await execAsync(`cp -r "${distDir}" "${backupDir}/dist"`);
    }

    const packageJson = join(this.projectRoot, 'package.json');
    if (existsSync(packageJson)) {
      await execAsync(`cp "${packageJson}" "${backupDir}/package.json"`);
    }

    this.notify(`Backup created at: ${backupDir}`);
  }

  /**
   * Extract downloaded archive and update files
   */
  private async extractAndUpdate(zipPath: string, tempDir: string): Promise<void> {
    // Extract zip
    await execAsync(`unzip -o "${zipPath}" -d "${tempDir}"`);

    // Find extracted directory (usually has version suffix)
    const extractedDirs = await execAsync(`ls -d ${tempDir}/*/ 2>/dev/null | head -1`);
    const extractedDir = extractedDirs.stdout.trim();

    if (!extractedDir) {
      throw new Error('Failed to find extracted directory');
    }

    // Copy src files
    const extractedSrc = join(extractedDir, 'src');
    if (existsSync(extractedSrc)) {
      await execAsync(`cp -r "${extractedSrc}"/* "${this.projectRoot}/src/"`);
    }

    // Copy package.json if updated
    const extractedPackage = join(extractedDir, 'package.json');
    if (existsSync(extractedPackage)) {
      await execAsync(`cp "${extractedPackage}" "${this.projectRoot}/package.json"`);
    }

    // Copy other config files
    const configFiles = ['tsconfig.json', '.gitignore', 'README.md'];
    for (const file of configFiles) {
      const extractedFile = join(extractedDir, file);
      if (existsSync(extractedFile)) {
        await execAsync(`cp "${extractedFile}" "${this.projectRoot}/${file}"`);
      }
    }
  }

  /**
   * Install npm dependencies
   */
  private async installDependencies(): Promise<void> {
    await execAsync('npm install --production', {
      cwd: this.projectRoot,
    });
  }

  /**
   * Build TypeScript
   */
  private async buildTypeScript(): Promise<void> {
    await execAsync('npm run build', {
      cwd: this.projectRoot,
    });
  }

  /**
   * Cleanup temporary files
   */
  private async cleanup(zipPath: string, tempDir: string): Promise<void> {
    try {
      await rm(zipPath, { force: true });
      await rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('[Updater] Cleanup warning:', e);
    }
  }

  /**
   * Rollback to previous version
   */
  private async rollback(): Promise<void> {
    try {
      // Find most recent backup
      const backups = await execAsync(`ls -dt ${this.projectRoot}/.backup-* 2>/dev/null | head -1`);
      const backupDir = backups.stdout.trim();

      if (backupDir) {
        this.notify('Rolling back to previous version...');

        // Restore src
        const backupSrc = join(backupDir, 'src');
        if (existsSync(backupSrc)) {
          await execAsync(`rm -rf "${this.projectRoot}/src" && cp -r "${backupSrc}" "${this.projectRoot}/src"`);
        }

        // Restore dist
        const backupDist = join(backupDir, 'dist');
        if (existsSync(backupDist)) {
          await execAsync(`rm -rf "${this.projectRoot}/dist" && cp -r "${backupDist}" "${this.projectRoot}/dist"`);
        }

        // Rebuild
        await this.buildTypeScript();

        this.notify('✅ Rollback completed');
      }
    } catch (error) {
      console.error('[Updater] Rollback failed:', error);
      this.notify('❌ Rollback failed, manual intervention required');
    }
  }

  /**
   * Start periodic update check
   */
  startPeriodicCheck(intervalMs: number = 6 * 60 * 60 * 1000): void {
    // Default: check every 6 hours
    this.stopPeriodicCheck();

    this.notify(`Starting periodic update check (every ${intervalMs / 1000 / 60} minutes)`);

    this.checkInterval = setInterval(async () => {
      await this.checkAndNotify();
    }, intervalMs);

    // Initial check
    this.checkAndNotify();
  }

  /**
   * Stop periodic update check
   */
  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
  }

  /**
   * Check for update and notify if available
   */
  async checkAndNotify(): Promise<UpdateInfo> {
    try {
      const updateInfo = await this.checkForUpdate();

      if (updateInfo.hasUpdate) {
        this.notify(`🆕 Update available: v${updateInfo.currentVersion} → v${updateInfo.latestVersion}`);

        if (updateInfo.releaseInfo) {
          this.notify(`📝 Release: ${updateInfo.releaseInfo.name}`);
          this.notify(`🔗 ${updateInfo.releaseInfo.html_url}`);

          // Show first few lines of changelog
          const changelog = updateInfo.releaseInfo.body.split('\n').slice(0, 5).join('\n');
          if (changelog) {
            this.notify(`📋 Changes:\n${changelog}`);
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

  /**
   * Auto-update if new version available
   */
  async autoUpdate(): Promise<boolean> {
    const updateInfo = await this.checkForUpdate();

    if (updateInfo.hasUpdate && updateInfo.releaseInfo) {
      this.notify(`Auto-updating to v${updateInfo.latestVersion}...`);
      return await this.installUpdate(updateInfo.releaseInfo);
    }

    return false;
  }
}

// Export singleton instance
let updaterInstance: PluginUpdater | null = null;

export function getUpdater(projectRoot?: string): PluginUpdater {
  if (!updaterInstance) {
    // import.meta.dirname points to dist/src/, so we go up TWO levels to project root
    const root = projectRoot || join(import.meta.dirname, '..', '..');
    updaterInstance = new PluginUpdater(root);
  }
  return updaterInstance;
}

/**
 * Get the plugin root directory (where package.json lives)
 */
export function getPluginRoot(): string {
  // When running from dist/src/*.js, go up two levels to project root
  return join(import.meta.dirname, '..', '..');
}

export default PluginUpdater;
