#!/usr/bin/env node
/**
 * PinsonBot Connector Updater CLI
 *
 * Usage:
 *   node updater.js --check    # Check for updates
 *   node updater.js --update   # Install update automatically
 *   node updater.js --help     # Show help
 */

import { getUpdater } from './dist/src/updater.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;  // CLI is in project root

function showHelp() {
  console.log(`
PinsonBot Connector Updater

Usage:
  node updater.js [options]

Options:
  --check, -c     Check for available updates
  --update, -u    Automatically download and install update
  --help, -h      Show this help message
  --version, -v   Show current version

Examples:
  node updater.js --check
  node updater.js --update

Auto-update is also available in the plugin:
  - Checks every 6 hours automatically
  - Notifies when update is available
  - Can be configured in plugin settings
`);
}

async function main() {
  const args = process.argv.slice(2);
  const updater = getUpdater(projectRoot);

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    showHelp();
    return;
  }

  if (args.includes('--version') || args.includes('-v')) {
    const version = updater.getCurrentVersion();
    console.log(`Current version: v${version}`);
    return;
  }

  if (args.includes('--check') || args.includes('-c')) {
    console.log('Checking for updates...\n');
    const updateInfo = await updater.checkAndNotify();
    
    if (updateInfo.hasUpdate) {
      console.log('\n💡 Run "node updater.js --update" to install the update');
    }
    return;
  }

  if (args.includes('--update') || args.includes('-u')) {
    console.log('Starting auto-update...\n');
    const success = await updater.autoUpdate();
    
    if (success) {
      console.log('\n✅ Update completed! Please restart OpenClaw Gateway.');
    } else {
      console.log('\n❌ Update failed or no update available.');
    }
    return;
  }

  console.log('Unknown option. Use --help for usage information.');
}

main().catch(console.error);
