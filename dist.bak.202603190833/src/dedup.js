/**
 * Message deduplication for PinsonBot.
 *
 * Prevents duplicate processing when messages are retried.
 * In-memory TTL map with lazy cleanup.
 */
const processedMessages = new Map();
const MESSAGE_DEDUP_TTL = 60_000; // 60 seconds
const MESSAGE_DEDUP_MAX_SIZE = 1_000;
let messageCounter = 0;
/**
 * Check whether a message has already been processed within the dedup window.
 */
export function isMessageProcessed(dedupKey) {
    const now = Date.now();
    const expiresAt = processedMessages.get(dedupKey);
    if (expiresAt === undefined) {
        return false;
    }
    if (now >= expiresAt) {
        processedMessages.delete(dedupKey);
        return false;
    }
    return true;
}
/**
 * Mark a message as processed and lazily clean up expired entries.
 */
export function markMessageProcessed(dedupKey) {
    const expiresAt = Date.now() + MESSAGE_DEDUP_TTL;
    processedMessages.set(dedupKey, expiresAt);
    // Hard cap for burst protection.
    if (processedMessages.size > MESSAGE_DEDUP_MAX_SIZE) {
        const now = Date.now();
        for (const [key, expiry] of processedMessages.entries()) {
            if (now >= expiry) {
                processedMessages.delete(key);
            }
        }
        // Safety valve: if still over cap, drop oldest entries.
        if (processedMessages.size > MESSAGE_DEDUP_MAX_SIZE) {
            const removeCount = processedMessages.size - MESSAGE_DEDUP_MAX_SIZE;
            let removed = 0;
            for (const key of processedMessages.keys()) {
                processedMessages.delete(key);
                if (++removed >= removeCount) {
                    break;
                }
            }
        }
        return;
    }
    // Deterministic lightweight cleanup every 10 messages.
    messageCounter++;
    if (messageCounter >= 10) {
        messageCounter = 0;
        const now = Date.now();
        for (const [key, expiry] of processedMessages.entries()) {
            if (now >= expiry) {
                processedMessages.delete(key);
            }
        }
    }
}
//# sourceMappingURL=dedup.js.map