'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_ROOMS,
    STATUS_PLAYING,
    STATUS_PAUSED,
    Room,
    effectivePositionMs,
    toPublicRoom,
    parseRoomUpdate,
    applyRoomUpdate,
    generateRoomCode,
    secretMatches,
} = require('../src/room');

// --- toPublicRoom ---

test('toPublicRoom never includes hostSecret or hostSocketId', () => {
    const room = new Room('1234', 'super-secret-value', 1000);
    room.hostSocketId = 'socket-abc-123';
    room.trackName = 'Some Track';

    const publicRoom = toPublicRoom(room, 3, 2000);
    const json = JSON.stringify(publicRoom);

    assert.ok(!json.includes('super-secret-value'), 'serialized room must not leak hostSecret value');
    assert.ok(!json.includes('socket-abc-123'), 'serialized room must not leak hostSocketId value');
    assert.ok(!Object.prototype.hasOwnProperty.call(publicRoom, 'hostSecret'));
    assert.ok(!Object.prototype.hasOwnProperty.call(publicRoom, 'hostSocketId'));

    assert.deepEqual(publicRoom, {
        roomCode: '1234',
        trackName: 'Some Track',
        artistName: null,
        videoId: null,
        albumArt: null,
        status: STATUS_PAUSED,
        positionMs: 0,
        durationMs: 0,
        updatedAt: 1000,
        hostConnected: true,
        listenerCount: 3,
        serverNow: 2000,
    });
});

// --- parseRoomUpdate: acceptance ---

test('parseRoomUpdate accepts a valid full payload', () => {
    const payload = {
        status: STATUS_PLAYING,
        positionMs: 1000,
        durationMs: 200000,
        trackName: 'Track',
        artistName: 'Artist',
        albumArt: 'https://example.com/art.png',
        videoId: 'dQw4w9WgXcQ',
    };
    const result = parseRoomUpdate(payload);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, payload);
});

test('parseRoomUpdate ignores unknown fields but still accepts known ones alongside them', () => {
    const result = parseRoomUpdate({
        hostSecret: 'abc123',
        roomCode: '9999',
        status: STATUS_PAUSED,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.value, { status: STATUS_PAUSED });
});

// --- parseRoomUpdate: rejection ---

test('parseRoomUpdate rejects a bad status', () => {
    const result = parseRoomUpdate({ status: 'buffering' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'status must be "playing" or "paused"');
});

test('parseRoomUpdate rejects a malformed videoId', () => {
    const result = parseRoomUpdate({ videoId: 'ab' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'videoId is malformed');
});

test('parseRoomUpdate rejects a non-https albumArt', () => {
    const result = parseRoomUpdate({ albumArt: 'http://example.com/art.png' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'albumArt must be https');
});

test('parseRoomUpdate rejects a negative positionMs', () => {
    const result = parseRoomUpdate({ positionMs: -1 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'positionMs out of range');
});

test('parseRoomUpdate rejects a NaN positionMs', () => {
    const result = parseRoomUpdate({ positionMs: NaN });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'positionMs must be a finite number');
});

test('parseRoomUpdate rejects an Infinity positionMs', () => {
    const result = parseRoomUpdate({ positionMs: Infinity });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'positionMs must be a finite number');
});

test('parseRoomUpdate rejects an over-long trackName', () => {
    const result = parseRoomUpdate({ trackName: 'x'.repeat(301) });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'trackName exceeds 300 chars');
});

test('parseRoomUpdate rejects an empty object', () => {
    const result = parseRoomUpdate({});
    assert.equal(result.ok, false);
    assert.equal(result.error, 'payload contained no known fields');
});

test('parseRoomUpdate rejects null', () => {
    const result = parseRoomUpdate(null);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'payload must be an object');
});

test('parseRoomUpdate rejects an array', () => {
    const result = parseRoomUpdate([{ status: STATUS_PLAYING }]);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'payload must be an object');
});

// --- applyRoomUpdate ---

test('applyRoomUpdate advances positionMs to its effective value before applying', () => {
    const room = new Room('1234', 'secret', 1000);
    room.status = STATUS_PLAYING;
    room.positionMs = 5000;
    room.updatedAt = 1000;
    room.durationMs = 0;

    // 3 seconds elapse, then the host pushes a status-only update (pause).
    const now = 4000;
    applyRoomUpdate(room, { status: STATUS_PAUSED }, now);

    assert.equal(room.status, STATUS_PAUSED);
    // positionMs should have advanced by the 3000ms elapsed while playing.
    assert.equal(room.positionMs, 8000);
    assert.equal(room.updatedAt, now);
    assert.equal(room.lastSeenAt, now);

    // The position/timestamp pair is now coherent: since the room is paused,
    // effectivePositionMs at any later time returns exactly positionMs.
    assert.equal(effectivePositionMs(room, now + 10000), 8000);
});

test('applyRoomUpdate leaves position alone when room was already paused', () => {
    const room = new Room('1234', 'secret', 1000);
    room.status = STATUS_PAUSED;
    room.positionMs = 2500;
    room.updatedAt = 1000;

    applyRoomUpdate(room, { trackName: 'New Track' }, 9000);

    assert.equal(room.positionMs, 2500);
    assert.equal(room.trackName, 'New Track');
    assert.equal(room.updatedAt, 9000);
});

// --- effectivePositionMs ---

test('effectivePositionMs: paused returns position unchanged', () => {
    const room = new Room('1234', 'secret', 0);
    room.status = STATUS_PAUSED;
    room.positionMs = 12345;
    room.updatedAt = 0;
    assert.equal(effectivePositionMs(room, 999999), 12345);
});

test('effectivePositionMs: playing advances by elapsed', () => {
    const room = new Room('1234', 'secret', 0);
    room.status = STATUS_PLAYING;
    room.positionMs = 1000;
    room.updatedAt = 0;
    room.durationMs = 1000000;
    assert.equal(effectivePositionMs(room, 2500), 3500);
});

test('effectivePositionMs: clamps at durationMs', () => {
    const room = new Room('1234', 'secret', 0);
    room.status = STATUS_PLAYING;
    room.positionMs = 9000;
    room.updatedAt = 0;
    room.durationMs = 10000;
    assert.equal(effectivePositionMs(room, 5000), 10000);
});

test('effectivePositionMs: durationMs === 0 does not clamp', () => {
    const room = new Room('1234', 'secret', 0);
    room.status = STATUS_PLAYING;
    room.positionMs = 9000;
    room.updatedAt = 0;
    room.durationMs = 0;
    assert.equal(effectivePositionMs(room, 5000), 14000);
});

test('effectivePositionMs: never negative even if now < updatedAt', () => {
    const room = new Room('1234', 'secret', 5000);
    room.status = STATUS_PLAYING;
    room.positionMs = 1000;
    room.updatedAt = 5000;
    room.durationMs = 10000;
    // `now` earlier than updatedAt (clock skew) must not produce negative elapsed.
    assert.equal(effectivePositionMs(room, 0), 1000);
});

// --- generateRoomCode ---

test('generateRoomCode always returns a 4-char zero-padded code', () => {
    const rooms = new Map();
    for (let i = 0; i < 50; i += 1) {
        const code = generateRoomCode(rooms);
        assert.equal(code.length, 4);
        assert.match(code, /^[0-9]{4}$/);
        rooms.set(code, {});
    }
});

test('generateRoomCode never collides with an occupied Map', () => {
    const rooms = new Map();
    rooms.set('0000', {});
    rooms.set('0001', {});
    rooms.set('0002', {});

    for (let i = 0; i < 20; i += 1) {
        const code = generateRoomCode(rooms);
        assert.ok(!rooms.has(code), `generated code ${code} collides with an existing room`);
        rooms.set(code, {});
    }
});

test('generateRoomCode: 0000 is reachable when it is the only free code', () => {
    const rooms = new Map();
    for (let i = 0; i < MAX_ROOMS; i += 1) {
        if (i === 0) continue; // leave 0000 free
        rooms.set(i.toString().padStart(4, '0'), {});
    }
    assert.equal(rooms.size, MAX_ROOMS - 1);

    const code = generateRoomCode(rooms);
    assert.equal(code, '0000');
});

test('generateRoomCode throws when the room Map is full', () => {
    const rooms = new Map();
    for (let i = 0; i < MAX_ROOMS; i += 1) {
        rooms.set(i.toString().padStart(4, '0'), {});
    }
    assert.throws(() => generateRoomCode(rooms), /No empty rooms available/);
});

// --- secretMatches ---

test('secretMatches: true for identical strings', () => {
    assert.equal(secretMatches('abc123', 'abc123'), true);
});

test('secretMatches: false for different strings', () => {
    assert.equal(secretMatches('abc123', 'abc124'), false);
});

test('secretMatches: false for different-length strings', () => {
    assert.equal(secretMatches('abc123', 'abc12'), false);
});

test('secretMatches: false for non-string, null, or undefined inputs', () => {
    assert.equal(secretMatches('abc123', null), false);
    assert.equal(secretMatches('abc123', undefined), false);
    assert.equal(secretMatches('abc123', 12345), false);
    assert.equal(secretMatches(null, 'abc123'), false);
    assert.equal(secretMatches(undefined, undefined), false);
});
