'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRateLimiter } = require('../src/rate-limiter');

test('burst is allowed then blocked', () => {
    const limiter = createRateLimiter(10, 20); // rate=10/s, burst=20
    const now = 1000;

    for (let i = 0; i < 20; i += 1) {
        assert.equal(limiter.allow('key1', now), true, `token ${i} should be allowed within burst`);
    }
    // Bucket is now empty; the next call at the same instant must be blocked.
    assert.equal(limiter.allow('key1', now), false);
});

test('tokens refill over injected elapsed time', () => {
    const limiter = createRateLimiter(10, 20); // 10 tokens/sec
    const now = 1000;

    for (let i = 0; i < 20; i += 1) {
        limiter.allow('key1', now);
    }
    assert.equal(limiter.allow('key1', now), false);

    // 500ms later, 5 tokens should have refilled.
    let later = now + 500;
    for (let i = 0; i < 5; i += 1) {
        assert.equal(limiter.allow('key1', later), true, `refilled token ${i} should be allowed`);
    }
    assert.equal(limiter.allow('key1', later), false);

    // A full second later, the bucket should be back at capacity (capped at burst).
    later = now + 500 + 10_000;
    for (let i = 0; i < 20; i += 1) {
        assert.equal(limiter.allow('key1', later), true, `capped refill token ${i} should be allowed`);
    }
    assert.equal(limiter.allow('key1', later), false);
});

test('different keys have independent buckets', () => {
    const limiter = createRateLimiter(10, 20);
    const now = 1000;

    for (let i = 0; i < 20; i += 1) {
        limiter.allow('key1', now);
    }
    assert.equal(limiter.allow('key1', now), false);
    // A different key's bucket is unaffected.
    assert.equal(limiter.allow('key2', now), true);
});

test('remove() drops the bucket, so the key starts fresh again', () => {
    const limiter = createRateLimiter(10, 20);
    const now = 1000;

    for (let i = 0; i < 20; i += 1) {
        limiter.allow('key1', now);
    }
    assert.equal(limiter.allow('key1', now), false);

    limiter.remove('key1');

    // Immediately after removal, at the same instant, a fresh bucket starts at full burst.
    assert.equal(limiter.allow('key1', now), true);
});
