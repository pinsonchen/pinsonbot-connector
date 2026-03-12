# PinsonBot Connector Auto-Update Framework

## Overview

The auto-update framework allows the PinsonBot Connector plugin to automatically check for and install updates from GitHub, ensuring you always have the latest features and bug fixes.

## Features

- ✅ **Automatic Update Checks**: Checks for updates every 6 hours
- ✅ **GitHub Integration**: Fetches latest release from GitHub Releases
- ✅ **Auto Download & Install**: Downloads and installs updates automatically
- ✅ **TypeScript Build**: Automatically compiles TypeScript after update
- ✅ **Backup & Rollback**: Creates backup before update, supports rollback on failure
- ✅ **Dependency Management**: Installs npm dependencies after update
- ✅ **Notification System**: Notifies via logs when updates are available
- ✅ **CLI Tools**: Manual check and update commands

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Plugin Startup                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Initialize Auto-Updater                        │
│  - Set notification callback                                │
│  - Start periodic check (6 hours)                           │
│  - Perform initial check                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Periodic Update Check                          │
│  - Fetch latest release from GitHub API                     │
│  - Compare versions (semver)                                │
│  - Cache result for offline support                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
         No Update                        Has Update
              │                               │
              ▼                               ▼
    ┌─────────────────┐            ┌─────────────────────┐
    │ Log: Up to date │            │ Notify: Update      │
    └─────────────────┘            │ Available           │
                                   └─────────────────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │ Auto-Install        │
                                   │ 1. Create backup    │
                                   │ 2. Download zip     │
                                   │ 3. Extract files    │
                                   │ 4. npm install      │
                                   │ 5. npm run build    │
                                   │ 6. Cleanup          │
                                   └─────────────────────┘
                                              │
                                              ▼
                                   ┌─────────────────────┐
                                   │ Notify: Restart     │
                                   │ Gateway required    │
                                   └─────────────────────┘
```

## Usage

### Automatic Updates (Default)

The updater runs automatically when the plugin starts:

```typescript
// In channel.ts - startAccount()
const updater = getUpdater();
updater.setNotifyCallback((message) => {
  ctx.log?.info?.(`[Updater] ${message}`);
});

// Start periodic check (every 6 hours)
updater.startPeriodicCheck(6 * 60 * 60 * 1000);
```

### Manual Check

```bash
cd /usr/local/projects/pinsonbot-connector
node updater-cli.js --check
```

### Manual Update

```bash
cd /usr/local/projects/pinsonbot-connector
node updater-cli.js --update
```

### Show Current Version

```bash
node updater-cli.js --version
```

## Configuration

### Update Check Interval

Default: 6 hours

```typescript
updater.startPeriodicCheck(intervalMs);
// Examples:
updater.startPeriodicCheck(60 * 60 * 1000);     // 1 hour
updater.startPeriodicCheck(24 * 60 * 60 * 1000); // 24 hours
```

### GitHub Repository

Default: `pinsonchen/pinsonbot-connector`

```typescript
const updater = new PluginUpdater(projectRoot, {
  githubRepo: 'your-username/your-repo'
});
```

### Auto-Install Mode

```typescript
// Enable auto-install (default: false)
const updater = new PluginUpdater(projectRoot, {
  autoInstall: true
});
```

## File Structure

```
pinsonbot-connector/
├── src/
│   ├── updater.ts          # Auto-update core logic
│   ├── channel.ts          # Plugin entry (integrates updater)
│   ├── ws-client.ts        # WebSocket client
│   └── ...
├── updater-cli.js          # CLI for manual updates
├── .last-checked-version   # Cached version info
├── .backup-<timestamp>/    # Backup before update
└── package.json
```

## Update Process

### 1. Check for Updates

- Fetches latest release from GitHub API
- Compares semantic versions
- Caches result for offline support

### 2. Download Update

- Downloads source code zip from GitHub
- Verifies download integrity

### 3. Create Backup

- Backs up `src/`, `dist/`, and `package.json`
- Backup stored in `.backup-<timestamp>/`

### 4. Install Update

- Extracts downloaded archive
- Replaces source files
- Runs `npm install --production`
- Runs `npm run build` (TypeScript compilation)

### 5. Cleanup

- Removes temporary files
- Keeps backup for rollback

### 6. Notify Restart

- Logs message requiring Gateway restart
- Plugin will use new code after restart

## Rollback

If update fails, automatic rollback is attempted:

```typescript
// Automatic on failure
async installUpdate(): Promise<boolean> {
  try {
    // ... update process
  } catch (error) {
    await this.rollback();  // Restore from backup
  }
}
```

## Logging

All updater actions are logged:

```
[Updater] Starting periodic update check (every 360 minutes)
[Updater] 🆕 Update available: v2.1.0 → v2.2.0
[Updater] 📝 Release: Auto-Update Framework
[Updater] 🔗 https://github.com/.../releases/tag/v2.2.0
[Updater] Starting update to v2.2.0...
[Updater] Creating backup...
[Updater] Downloading update...
[Updater] Installing dependencies...
[Updater] Building TypeScript...
[Updater] ✅ Update to v2.2.0 completed successfully!
[Updater] 🔄 Please restart OpenClaw Gateway to apply the update.
```

## Security Considerations

- ✅ Downloads only from official GitHub repository
- ✅ Uses HTTPS for all downloads
- ✅ Creates backup before modifying files
- ✅ Validates version format (semver)
- ✅ Rate limit handling with fallback to cache

## Troubleshooting

### Update Fails

1. Check network connectivity
2. Verify GitHub API access
3. Check disk space
4. Review logs for specific error
5. Manual rollback from `.backup-<timestamp>/`

### Rate Limited

GitHub API has rate limits (60 requests/hour for unauthenticated):
- Updater caches last known version
- Falls back to cache on rate limit

### TypeScript Build Fails

- Ensure all dependencies installed
- Check TypeScript version compatibility
- Review compilation errors in logs

## Future Enhancements

- [ ] Signed release verification
- [ ] Delta updates (only changed files)
- [ ] Scheduled update window
- [ ] Update staging/preview channel
- [ ] Webhook notifications
- [ ] Update statistics/metrics

## API Reference

### PluginUpdater Class

#### Constructor

```typescript
new PluginUpdater(projectRoot: string, options?: UpdateOptions)
```

#### Methods

| Method | Description |
|--------|-------------|
| `getCurrentVersion()` | Get current version from package.json |
| `fetchLatestRelease()` | Fetch latest release from GitHub |
| `checkForUpdate()` | Check if update is available |
| `installUpdate(release)` | Download and install update |
| `startPeriodicCheck(intervalMs)` | Start periodic update checks |
| `stopPeriodicCheck()` | Stop periodic checks |
| `checkAndNotify()` | Check and log update status |
| `autoUpdate()` | Check and auto-install if available |
| `setNotifyCallback(callback)` | Set notification callback |

## License

MIT License - See LICENSE file for details.
