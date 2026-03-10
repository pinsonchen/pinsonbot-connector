/**
 * Configuration schema for PinsonBot Connector
 * 
 * CRITICAL SECURITY NOTES:
 * - Each lobster has its own unique internal_token (per-lobster authentication)
 * - internal_token is bound to a specific lobster_id and cannot be reused
 * - Never share or expose internal_token values
 * - Save credentials immediately when creating a new lobster
 */

export interface ConfigSchema {
  /**
   * OpenClaw configuration
   */
  openclaw: {
    /**
     * OpenClaw API endpoint
     * @default "http://localhost:8080"
     */
    endpoint?: string;
    
    /**
     * OpenClaw API key (if required)
     */
    apiKey?: string;
  };
  
  /**
   * PinsonBots Platform configuration
   */
  channels: {
    pinsonbot: {
      /**
       * Enable/disable PinsonBot channel
       * @default false
       */
      enabled?: boolean;
      
      /**
       * PinsonBots Platform WebSocket endpoint
       * @default "ws://localhost:8000/pinsonbots/internal/plugin"
       */
      endpoint?: string;
      
      /**
       * Multiple accounts configuration
       * Each account represents a connection to a different lobster
       * 
       * SECURITY: Each lobster has independent credentials
       * - lobsterId: 10-character random string (e.g., "aB3xK9mN2p")
       * - internalToken: Unique token bound to that specific lobster
       * 
       * Example:
       * {
       *   "customer-service": {
       *     "lobsterId": "aB3xK9mN2p",
       *     "internalToken": "token_for_lobster_aB3xK9mN2p_only"
       *   },
       *   "sales-bot": {
       *     "lobsterId": "xY7pL2qR5n",
       *     "internalToken": "token_for_lobster_xY7pL2qR5n_only"
       *   }
       * }
       */
      accounts: {
        [accountName: string]: {
          /**
           * Lobster ID from PinsonBots Platform
           * Format: 10-character alphanumeric string
           * Example: "aB3xK9mN2p"
           */
          lobsterId: string;
          
          /**
           * Internal token for Plugin WebSocket authentication
           * This token is SPECIFIC to the lobster and cannot be used for other lobsters
           * Length: 128 characters (hex string)
           * 
           * ⚠️ SECURITY WARNING:
           * - Only returned at lobster creation time
           * - Never exposed in API responses after creation
           * - Keep this token secret and secure
           * - Compromise of this token allows access to ONLY this specific lobster
           */
          internalToken: string;
          
          /**
           * Optional: Account display name
           */
          name?: string;
          
          /**
           * Optional: Enable/disable this specific account
           * @default true
           */
          enabled?: boolean;
        };
      };
      
      /**
       * Connection retry configuration
       */
      retry?: {
        /**
         * Maximum retry attempts
         * @default 5
         */
        maxAttempts?: number;
        
        /**
         * Delay between retries in milliseconds
         * @default 5000
         */
        delayMs?: number;
        
        /**
         * Exponential backoff multiplier
         * @default 2
         */
        backoffMultiplier?: number;
      };
      
      /**
       * Health check configuration
       */
      healthCheck?: {
        /**
         * Enable periodic health checks
         * @default true
         */
        enabled?: boolean;
        
        /**
         * Health check interval in milliseconds
         * @default 30000
         */
        intervalMs?: number;
      };
    };
  };
  
  /**
   * Logging configuration
   */
  logging?: {
    /**
     * Log level
     * @default "info"
     */
    level?: 'debug' | 'info' | 'warn' | 'error';
    
    /**
     * Log file path (optional)
     * If not specified, logs to console only
     */
    filePath?: string;
  };
}
