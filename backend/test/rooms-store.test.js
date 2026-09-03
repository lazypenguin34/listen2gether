'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ROOM_MAX_IDLE_MS, ROOM_ABANDONED_MS, sweepRooms } = require('../src/rooms-store');

function makeRoom({ createdAt, updatedAt, lastSeenAt }) {
    return { createdAt, updatedAt, lastSeenAt };
}

test('sweepRooms evicts a room idle beyond the limit', () => {
    const now = 10_000_000;
    const rooms = new Map();
    rooms.set('idle', makeRoom({
        createdAt: now - ROOM_MAX_IDLE_MS - 1000,
        updatedAt: now - ROOM_MAX_IDLE_MS - 500,
        lastSeenAt: now - ROOM_MAX_IDLE_MS - 1,
    }));

    const evicted = sweepRooms(rooms, now);

    assert.equal(evicted, 1);
    assert.equal(rooms.size, 0);
});

test('sweepRooms evicts a never-updated room past the abandoned grace period', () => {
    const now = 10_000_000;
    const rooms = new Map();
    rooms.set('abandoned', makeRoom({
        createdAt: now - ROOM_ABANDONED_MS - 1,
        updatedAt: now - ROOM_ABANDONED_MS - 1, // never updated: updatedAt === createdAt
        lastSeenAt: now - ROOM_ABANDONED_MS - 1,
    }));

    const evicted = sweepRooms(rooms, now);

    assert.equal(evicted, 1);
    assert.equal(rooms.size, 0);
});

test('sweepRooms keeps a fresh room', () => {
    const now = 10_000_000;
    const rooms = new Map();
    rooms.set('fresh', makeRoom({
        createdAt: now - 1000,
        updatedAt: now - 1000,
        lastSeenAt: now - 500,
    }));

    const evicted = sweepRooms(rooms, now);

    assert.equal(evicted, 0);
    assert.equal(rooms.size, 1);
    assert.ok(rooms.has('fresh'));
});

test('sweepRooms keeps a room that is old but recently active', () => {
    const now = 10_000_000;
    const rooms = new Map();
    rooms.set('old-but-active', makeRoom({
        createdAt: now - ROOM_MAX_IDLE_MS * 5, // far older than the abandoned grace period
        updatedAt: now - 1000, // but was updated recently
        lastSeenAt: now - 1000, // and seen recently
    }));

    const evicted = sweepRooms(rooms, now);

    assert.equal(evicted, 0);
    assert.equal(rooms.size, 1);
    assert.ok(rooms.has('old-but-active'));
});

test('sweepRooms handles a mix, evicting only what qualifies', () => {
    const now = 10_000_000;
    const rooms = new Map();
    rooms.set('idle', makeRoom({
        createdAt: now - ROOM_MAX_IDLE_MS - 1000,
        updatedAt: now - ROOM_MAX_IDLE_MS - 500,
        lastSeenAt: now - ROOM_MAX_IDLE_MS - 1,
    }));
    rooms.set('abandoned', makeRoom({
        createdAt: now - ROOM_ABANDONED_MS - 1,
        updatedAt: now - ROOM_ABANDONED_MS - 1,
        lastSeenAt: now - ROOM_ABANDONED_MS - 1,
    }));
    rooms.set('fresh', makeRoom({
        createdAt: now - 1000,
        updatedAt: now - 1000,
        lastSeenAt: now - 500,
    }));

    const evicted = sweepRooms(rooms, now);

    assert.equal(evicted, 2);
    assert.equal(rooms.size, 1);
    assert.ok(rooms.has('fresh'));
});
