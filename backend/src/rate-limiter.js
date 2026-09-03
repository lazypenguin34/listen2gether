'use strict';

/**
 * A minimal per-key token bucket. No dependency, no timers — tokens refill
 * lazily based on elapsed wall-clock time whenever `allow` is called.
 *
 * Used to cap how often a single socket can push `updateRoom` events:
 * ~RATE per second sustained, with a small burst allowance on top.
 */
const DEFAULT_RATE = 10; // tokens refilled per second
const DEFAULT_BURST = 20; // bucket capacity

function createRateLimiter(rate = DEFAULT_RATE, burst = DEFAULT_BURST) {
    const buckets = new Map();

    return {
        /** Returns true if the call for `key` is allowed, consuming a token. */
        allow(key, now = Date.now()) {
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = { tokens: burst, last: now };
                buckets.set(key, bucket);
            }

            const elapsedSeconds = Math.max(0, now - bucket.last) / 1000;
            bucket.tokens = Math.min(burst, bucket.tokens + elapsedSeconds * rate);
            bucket.last = now;

            if (bucket.tokens < 1) return false;
            bucket.tokens -= 1;
            return true;
        },

        /** Drop bookkeeping for a key (e.g. on socket disconnect) so the Map can't grow forever. */
        remove(key) {
            buckets.delete(key);
        },
    };
}

module.exports = { createRateLimiter, DEFAULT_RATE, DEFAULT_BURST };
