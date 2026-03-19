/**
 * Message deduplication for PinsonBot.
 *
 * Prevents duplicate processing when messages are retried.
 * In-memory TTL map with lazy cleanup.
 */
/**
 * Check whether a message has already been processed within the dedup window.
 */
export declare function isMessageProcessed(dedupKey: string): boolean;
/**
 * Mark a message as processed and lazily clean up expired entries.
 */
export declare function markMessageProcessed(dedupKey: string): void;
//# sourceMappingURL=dedup.d.ts.map