'use strict';

/**
 * The room model and the wire format.
 *
 * This module is the single source of truth for what a room is and what
 * crosses the network. Anything that serializes a room MUST go through
 * `toPublicRoom`; anything that accepts host state MUST go through
 * `parseRoomUpdate`. Do not hand-roll either shape elsewhere.
 */

const crypto = require('crypto');

// --- Constants ---
const MAX_ROOMS = 10000; // codes 0000-9999
const ROOM_CODE_LENGTH = 4;
const HOST_SECRET_BYTES = 32;

const STATUS_PLAYING = 'playing';
const STATUS_PAUSED = 'paused';
const STATUSES = new Set([STATUS_PLAYING, STATUS_PAUSED]);

const MAX_TEXT_LENGTH = 300;
const MAX_URL_LENGTH = 2048;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const VIDEO_ID_RE = /^[\w-]{5,20}$/;

// --- Model ---
class Room {
    constructor(roomCode, hostSecret, now = Date.now()) {
        this.roomCode = roomCode;
        this.hostSecret = hostSecret; // never leaves the server

        this.trackName = null;
        this.artistName = null;
        this.videoId = null;
        this.albumArt = null;

        this.status = STATUS_PAUSED;
        this.positionMs = 0;
        this.durationMs = 0;

        // Server clock. The instant at which `positionMs` was true.
        // Clients interpolate forward from this; never trust a client's clock.
        this.updatedAt = now;

        this.createdAt = now;
        this.lastSeenAt = now;
        this.hostSocketId = null;
    }

    get hostConnected() {
        return this.hostSocketId !== null;
    }
}

/**
 * Where playback actually is right now, accounting for time elapsed since the
 * host's last push. Mirrored on the client in frontend/src/lib/playback.js —
 * keep the two in step.
 */
function effectivePositionMs(room, now = Date.now()) {
    if (room.status !== STATUS_PLAYING) return room.positionMs;
    const advanced = room.positionMs + Math.max(0, now - room.updatedAt);
    return room.durationMs > 0 ? Math.min(advanced, room.durationMs) : advanced;
}

// --- Wire format (server -> client) ---
/**
 * The ONLY shape sent to clients. `hostSecret`, `hostSocketId` and the raw
 * bookkeeping timestamps are deliberately absent.
 */
function toPublicRoom(room, listenerCount = 0, now = Date.now()) {
    return {
        roomCode: room.roomCode,
        trackName: room.trackName,
        artistName: room.artistName,
        videoId: room.videoId,
        albumArt: room.albumArt,
        status: room.status,
        positionMs: room.positionMs,
        durationMs: room.durationMs,
        updatedAt: room.updatedAt,
        hostConnected: room.hostConnected,
        listenerCount,
        // Lets the client derive a clock offset: offset = serverNow - Date.now()
        serverNow: now,
    };
}

// --- Wire format (client -> server) ---
function invalid(error) {
    return { ok: false, error };
}

function parseText(value, field) {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return invalid(`${field} must be a string or null`);
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) return invalid(`${field} exceeds ${MAX_TEXT_LENGTH} chars`);
    return { ok: true, value: trimmed || null };
}

function parseMs(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(`${field} must be a finite number`);
    }
    if (value < 0 || value > MAX_DURATION_MS) return invalid(`${field} out of range`);
    return { ok: true, value: Math.round(value) };
}

function parseAlbumArt(value) {
    if (value === null) return { ok: true, value: null };
    if (typeof value !== 'string') return invalid('albumArt must be a string or null');
    if (value.length > MAX_URL_LENGTH) return invalid('albumArt too long');
    let url;
    try {
        url = new URL(value);
    } catch {
        return invalid('albumArt is not a valid URL');
    }
    if (url.protocol !== 'https:') return invalid('albumArt must be https');
    return { ok: true, value: url.toString() };
}

/**
 * Validates a host's state push. Strict: a present-but-invalid field rejects
 * the whole payload rather than being silently dropped, so a buggy or hostile
 * client fails loudly instead of half-applying.
 *
 * Returns { ok: true, value: {...only the fields present...} }
 *      or { ok: false, error: string }
 */
function parseRoomUpdate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return invalid('payload must be an object');
    }

    const update = {};
    const has = (key) => Object.prototype.hasOwnProperty.call(payload, key) && payload[key] !== undefined;

    if (has('status')) {
        if (!STATUSES.has(payload.status)) return invalid('status must be "playing" or "paused"');
        update.status = payload.status;
    }

    for (const field of ['positionMs', 'durationMs']) {
        if (has(field)) {
            const parsed = parseMs(payload[field], field);
            if (!parsed.ok) return parsed;
            update[field] = parsed.value;
        }
    }

    for (const field of ['trackName', 'artistName']) {
        if (has(field)) {
            const parsed = parseText(payload[field], field);
            if (!parsed.ok) return parsed;
            update[field] = parsed.value;
        }
    }

    if (has('albumArt')) {
        const parsed = parseAlbumArt(payload.albumArt);
        if (!parsed.ok) return parsed;
        update.albumArt = parsed.value;
    }

    if (has('videoId')) {
        if (payload.videoId === null) {
            update.videoId = null;
        } else if (typeof payload.videoId !== 'string' || !VIDEO_ID_RE.test(payload.videoId)) {
            return invalid('videoId is malformed');
        } else {
            update.videoId = payload.videoId;
        }
    }

    if (Object.keys(update).length === 0) return invalid('payload contained no known fields');
    return { ok: true, value: update };
}

/**
 * Applies a validated update. Advances `positionMs` to its effective value
 * first, so that an update carrying only `status` (or only a track change)
 * still leaves a coherent position/timestamp pair.
 */
function applyRoomUpdate(room, update, now = Date.now()) {
    room.positionMs = effectivePositionMs(room, now);
    Object.assign(room, update);
    room.updatedAt = now;
    room.lastSeenAt = now;
    return room;
}

// --- Identifiers ---
function generateHostSecret() {
    return crypto.randomBytes(HOST_SECRET_BYTES).toString('hex');
}

function generateRoomCode(rooms) {
    if (rooms.size >= MAX_ROOMS) throw new Error('No empty rooms available.');
    let roomCode;
    do {
        roomCode = crypto.randomInt(0, MAX_ROOMS).toString().padStart(ROOM_CODE_LENGTH, '0');
    } while (rooms.has(roomCode));
    return roomCode;
}

/** Timing-safe compare that tolerates length mismatch and non-strings. */
function secretMatches(expected, provided) {
    if (typeof expected !== 'string' || typeof provided !== 'string') return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

module.exports = {
    MAX_ROOMS,
    ROOM_CODE_LENGTH,
    STATUS_PLAYING,
    STATUS_PAUSED,
    MAX_TEXT_LENGTH,
    VIDEO_ID_RE,
    Room,
    effectivePositionMs,
    toPublicRoom,
    parseRoomUpdate,
    applyRoomUpdate,
    generateHostSecret,
    generateRoomCode,
    secretMatches,
};
