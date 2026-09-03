/**
 * Client for the YouTube Music Desktop (YTMD) companion app's local HTTP
 * API. Used both by the host (to read/observe local playback) and by
 * listeners (to read local playback AND issue corrective commands).
 *
 * The pairing handshake and the raw response shapes here were reverse
 * engineered from the pre-rewrite duplicated logic in Home.jsx and
 * Room.jsx — this module is the single place that speaks the YTMD wire
 * format from now on.
 */

import { YTMD_URL, YTMD_APP_ID, YTMD_APP_NAME, YTMD_APP_VERSION, TRACK_STATE, STORAGE_KEYS, LEGACY_STORAGE_KEYS } from './config.js';

/**
 * Normalized YTMD playback snapshot. Callers should only ever touch this
 * shape, never the raw companion API response.
 *
 * @typedef {object} YtmdState
 * @property {'playing'|'paused'|'buffering'} status
 * @property {number}      positionMs
 * @property {number}      durationMs     0 when unknown
 * @property {string|null} trackName
 * @property {string|null} artistName
 * @property {string|null} albumArt       https URL, or null
 * @property {string|null} videoId
 * @property {number}      polledAt       `Date.now()` when this snapshot was taken
 */

/** Builds an `Error` carrying the HTTP status, so callers can branch on 401 etc. */
function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
}

async function postJson(path, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = token; // bare token, no "Bearer " prefix
    const res = await fetch(`${YTMD_URL}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        throw httpError(`YTMD request to ${path} failed (${res.status})`, res.status);
    }
    return res.status === 204 ? null : res.json();
}

function mapTrackState(trackState) {
    switch (trackState) {
        case TRACK_STATE.PLAYING:
            return 'playing';
        case TRACK_STATE.BUFFERING:
            return 'buffering';
        case TRACK_STATE.PAUSED:
        case TRACK_STATE.UNKNOWN:
        default:
            return 'paused';
    }
}

/** Picks the largest thumbnail and coerces it to an https URL, or `null`. */
function pickAlbumArt(thumbnails) {
    if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;

    const largest = thumbnails.reduce((best, candidate) => {
        const area = (candidate?.width || 0) * (candidate?.height || 0);
        const bestArea = (best?.width || 0) * (best?.height || 0);
        return area > bestArea ? candidate : best;
    }, thumbnails[0]);

    const url = largest?.url;
    if (typeof url !== 'string') return null;
    if (url.startsWith('https://')) return url;
    if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
    return null; // protocol-relative/data/other URLs: backend requires https, drop rather than 400
}

/**
 * Flattens the raw companion API `/api/v1/state` response into a stable
 * shape. Never returns raw `state.player`/`state.video` to callers.
 *
 * @param {object} raw
 * @returns {YtmdState}
 */
function normalizeState(raw) {
    const player = raw?.player || {};
    const video = raw?.video || {};
    return {
        status: mapTrackState(player.trackState),
        positionMs: Math.round((player.videoProgress || 0) * 1000),
        durationMs: Math.round((video.durationSeconds || 0) * 1000),
        trackName: video.title || null,
        artistName: video.author || null,
        albumArt: pickAlbumArt(video.thumbnails),
        videoId: video.id || null,
        polledAt: Date.now(),
    };
}

/**
 * Runs the two-step YTMD pairing handshake: request a pairing code, then
 * exchange it for a token once the user approves the request inside the
 * desktop app.
 *
 * @returns {Promise<string>} the paired auth token
 * @throws {Error} if either step fails (e.g. companion app not running, or
 *   the user never approves the pairing request)
 */
export async function requestToken() {
    const { code } = await postJson('/api/v1/auth/requestcode', {
        appId: YTMD_APP_ID,
        appName: YTMD_APP_NAME,
        appVersion: YTMD_APP_VERSION,
    });
    const { token } = await postJson('/api/v1/auth/request', {
        appId: YTMD_APP_ID,
        code,
    });
    return token;
}

/**
 * Reads current playback state from the local YTMD companion app.
 *
 * @param {string} token
 * @returns {Promise<YtmdState>}
 * @throws {Error} with `.status` set to the HTTP status (e.g. 401 if the
 *   token was revoked, or a network error with no `.status` if the
 *   companion app is unreachable)
 */
export async function getState(token) {
    const res = await fetch(`${YTMD_URL}/api/v1/state`, {
        headers: { Authorization: token },
    });
    if (!res.ok) {
        throw httpError(`YTMD state request failed (${res.status})`, res.status);
    }
    const raw = await res.json();
    return normalizeState(raw);
}

/**
 * Issues a command to the local YTMD companion app.
 *
 * @param {string} token
 * @param {string} command    e.g. 'play', 'pause', 'seekTo', 'changeVideo'
 * @param {*} [data]           command-specific payload; omitted entirely when undefined
 * @returns {Promise<void>}
 * @throws {Error} with `.status` set to the HTTP status
 */
export async function sendCommand(token, command, data) {
    await postJson('/api/v1/command', data === undefined ? { command } : { command, data }, token);
}

/**
 * @param {string} token
 * @param {string} videoId
 * @returns {Promise<void>}
 */
export function changeVideo(token, videoId) {
    return sendCommand(token, 'changeVideo', { videoId });
}

/** @param {string} token @returns {Promise<void>} */
export function play(token) {
    return sendCommand(token, 'play');
}

/** @param {string} token @returns {Promise<void>} */
export function pause(token) {
    return sendCommand(token, 'pause');
}

/**
 * @param {string} token
 * @param {number} seconds
 * @returns {Promise<void>}
 */
export function seekTo(token, seconds) {
    return sendCommand(token, 'seekTo', seconds);
}

let legacyMigrationRan = false;

/**
 * One-time migration from the pre-rewrite storage keys to
 * `STORAGE_KEYS.ytmdToken`. Adopts the first legacy token found (host token
 * takes priority over the listener token, matching object key order) when
 * no current token is already stored, then removes every key in
 * `LEGACY_STORAGE_KEYS` regardless. Safe to call repeatedly; only does
 * work once per page load.
 *
 * @returns {void}
 */
export function migrateLegacyStorage() {
    if (legacyMigrationRan) return;
    legacyMigrationRan = true;

    try {
        if (!localStorage.getItem(STORAGE_KEYS.ytmdToken)) {
            const legacyTokenKeys = ['ytmd_token', 'ytmd_listener_token'];
            for (const key of legacyTokenKeys) {
                const value = localStorage.getItem(key);
                if (value) {
                    localStorage.setItem(STORAGE_KEYS.ytmdToken, value);
                    break;
                }
            }
        }
        for (const key of LEGACY_STORAGE_KEYS) {
            localStorage.removeItem(key);
        }
    } catch {
        // localStorage unavailable (SSR / private mode) - nothing to migrate.
    }
}

/**
 * Reads the stored YTMD token, running the legacy-key migration first.
 * @returns {string|null}
 */
export function readStoredToken() {
    migrateLegacyStorage();
    try {
        return localStorage.getItem(STORAGE_KEYS.ytmdToken);
    } catch {
        return null;
    }
}

/**
 * @param {string} token
 * @returns {void}
 */
export function storeToken(token) {
    try {
        localStorage.setItem(STORAGE_KEYS.ytmdToken, token);
    } catch {
        // ignore write failures (private mode / storage full)
    }
}

/** @returns {void} */
export function clearToken() {
    try {
        localStorage.removeItem(STORAGE_KEYS.ytmdToken);
    } catch {
        // ignore
    }
}
