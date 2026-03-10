/**
 * PinsonBot Connector - Main Entry Point
 * 
 * This connector bridges OpenClaw with the PinsonBots Platform,
 * enabling WeChat users to interact with local OpenClaw instances.
 */

import * as dotenv from 'dotenv';
import { PinsonBotWSClient } from './ws-client';
import { ConfigSchema } from './config-schema';

// Load environment variables
dotenv.config();

/**
 * Main connector class
 */
class PinsonBotConnector {
  private config: ConfigSchema;
  private clients: Map<string, PinsonBotWSClient> = new Map();

  constructor(config: ConfigSchema) {
    this.config = config;
  }

  /**
   * Initialize and start all configured accounts
   */
  async start(): Promise<void> {
    console.log('🚀 Starting PinsonBot Connector v2.0.0');
    console.log('=====================================');
    
    const pinsonbotConfig = this.config.channels.pinsonbot;
    
    if (!pinsonbotConfig?.enabled) {
      console.log('ℹ️  PinsonBot channel is disabled');
     return;
    }

    console.log('✅ PinsonBot channel enabled');
    console.log(`📡 Endpoint: ${pinsonbotConfig.endpoint || 'ws://localhost:8000/pinsonbots/internal/plugin'}`);
    
    const accounts = pinsonbotConfig.accounts || {};
    const accountNames = Object.keys(accounts);

    if (accountNames.length === 0) {
      console.warn('⚠️  No accounts configured');
     return;
    }

    console.log(`🔑 Found ${accountNames.length} account(s): ${accountNames.join(', ')}`);
    console.log('');

    // Initialize each account
    for (const [accountName, accountConfig] of Object.entries(accounts)) {
      if (!accountConfig.enabled) {
        console.log(`⏭️  Skipping disabled account: ${accountName}`);
        continue;
      }

      await this.initializeAccount(accountName, accountConfig);
    }

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Initialize a single account
   */
  private async initializeAccount(
    accountName: string,
    accountConfig: { lobsterId: string; internalToken: string; name?: string }
  ): Promise<void> {
    const { lobsterId, internalToken, name } = accountConfig;

    console.log(`\n🦞 Initializing account: ${name || accountName}`);
    console.log(`   Lobster ID: ${lobsterId}`);
    console.log(`   Internal Token: ${internalToken.substring(0, 16)}...`);

    try {
      // Create WebSocket client
      const endpoint = this.config.channels.pinsonbot?.endpoint;
      const retryConfig = this.config.channels.pinsonbot?.retry;

      const client = new PinsonBotWSClient(
        lobsterId,
        internalToken,
       endpoint,
        {
         maxReconnectAttempts: retryConfig?.maxAttempts,
         reconnectDelay: retryConfig?.delayMs,
         reconnectBackoff: retryConfig?.backoffMultiplier
        }
      );

      // Setup event handlers
      client.on('connected', () => {
        console.log(`✅ [${accountName}] Connected to PinsonBots Platform`);
        client.sendStatusUpdate('connected');
      });

      client.on('disconnected', ({ code, reason }) => {
        console.log(`❌ [${accountName}] Disconnected: ${code} - ${reason}`);
      });

      client.on('user_message', async ({ content, sessionId }) => {
        console.log(`💬 [${accountName}] Received user message (session: ${sessionId})`);
        
        try {
          // Forward to OpenClaw for processing
          const response = await this.processWithOpenClaw(content, sessionId);
          
          // Send response back to platform
          client.sendAssistantResponse(response, sessionId);
          console.log(`✅ [${accountName}] Sent response to platform`);
        } catch (error) {
          console.error(`❌ [${accountName}] Failed to process message:`, error);
        }
      });

      client.on('history', ({ sessionId, messages }) => {
        console.log(`📜 [${accountName}] Received history for session ${sessionId}: ${messages.length} messages`);
      });

      client.on('error', ({ type, error }) => {
        console.error(`❌ [${accountName}] Error (${type}):`, error.message || error);
      });

      client.on('server_error', (data) => {
        console.error(`❌ [${accountName}] Server error:`, data);
      });

      // Store client
      this.clients.set(accountName, client);

      // Connect
      console.log(`🔌 [${accountName}] Connecting...`);
      client.connect();

    } catch (error) {
      console.error(`❌ [${accountName}] Failed to initialize:`, error);
    }
  }

  /**
   * Process message with OpenClaw
   * TODO: Implement actual OpenClaw integration
   */
  private async processWithOpenClaw(content: string, sessionId: string): Promise<string> {
    // Placeholder implementation
    // In production, this would call OpenClaw's API
    
    console.log(`🤖 Processing with OpenClaw: "${content.substring(0, 50)}..."`);
    
    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return placeholder response
   return `Echo: ${content}`;
  }

  /**
   * Get status of all connections
   */
  getStatus(): Record<string, any> {
    const status: Record<string, any> = {};

    for (const [accountName, client] of this.clients.entries()) {
      status[accountName] = client.getStats();
    }

   return status;
  }

  /**
   * Setup graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      
      const promises: Promise<void>[] = [];

      for (const [accountName, client] of this.clients.entries()) {
        console.log(`Disconnecting ${accountName}...`);
        client.disconnect();
        promises.push(Promise.resolve());
      }

      await Promise.all(promises);
      console.log('✅ All connections closed');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

/**
 * Load configuration from environment and config file
 */
function loadConfig(): ConfigSchema {
  // TODO: Implement proper config loading from file
  // For now, load from environment variables
  
  const config: ConfigSchema = {
   openclaw: {
     endpoint: process.env.OPENCLAW_ENDPOINT || 'http://localhost:8080',
      apiKey: process.env.OPENCLAW_API_KEY
    },
    channels: {
      pinsonbot: {
       enabled: process.env.PINSONBOT_ENABLED !== 'false',
       endpoint: process.env.PINSONBOT_ENDPOINT,
        accounts: {}
      }
    },
    logging: {
      level: (process.env.LOG_LEVEL as any) || 'info'
    }
  };

  // Parse accounts from environment
  // Format: PINSONBOT_ACCOUNT_<NAME>=lobsterId:internalToken
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PINSONBOT_ACCOUNT_') && value) {
      const accountName = key.replace('PINSONBOT_ACCOUNT_', '').toLowerCase();
      const [lobsterId, internalToken] = value.split(':');
      
      if (!lobsterId || !internalToken) {
        console.warn(`⚠️  Invalid account format for ${key}: expected "lobsterId:internalToken"`);
        continue;
      }

      config.channels.pinsonbot.accounts[accountName] = {
        lobsterId,
        internalToken,
        name: accountName
      };
    }
  }

  return config;
}

/**
 * Main entry point
 */
async function main() {
  try {
    const config = loadConfig();
    const connector = new PinsonBotConnector(config);
    await connector.start();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Start the connector
main().catch(console.error);
