/**
 * Every tunable constant and every external URL lives here.
 *
 * Nothing else in the frontend should contain a literal URL, interval, or
 * localStorage key. If you need a new one, add it here.
 */

// --- Endpoints ---
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8888';

// The YTMD companion server. Its port is user-configurable in the desktop app,
// so this is overridable at build time.
export const YTMD_URL = import.meta.env.VITE_YTMD_URL || 'http://localhost:9863';

// --- YTMD pairing identity ---
// Changing appId invalidates every existing pairing, so leave it alone.
export const YTMD_APP_ID = 'listen2gether';
export const YTMD_APP_NAME = 'listen2gether';
export const YTMD_APP_VERSION = '2.0.0';

// --- Timing ---
// The host poll interval was tuned empirically (see git history: several
// commits raising it). Position accuracy no longer depends on it — clients
// interpolate — so it only bounds how fast a track change propagates.
export const HOST_POLL_INTERVAL_MS = 5500;
export const LISTENER_POLL_INTERVAL_MS = 5500;
export const LISTENER_CONTROL_INTERVAL_MS = 1500;

// Push state at least this often even when nothing changed, so late joiners
// and accumulated clock drift self-correct.
export const HOST_HEARTBEAT_MS = 15000;

// Host: position diverging from its expected value by more than this means the
// user actually seeked (rather than the track simply playing on).
export const SEEK_TOLERANCE_MS = 1500;

// Listener: correct our own player only once we are this far out of step.
export const DRIFT_TOLERANCE_MS = 2000;

export const ADMIN_POLL_INTERVAL_MS = 5000;

// --- YTMD player states (companion API `player.trackState`) ---
export const TRACK_STATE = {
    UNKNOWN: -1,
    PAUSED: 0,
    PLAYING: 1,
    BUFFERING: 2,
};

// --- Storage ---
// Namespaced so they are greppable and clearable as a group.
export const STORAGE_KEYS = {
    ytmdToken: 'l2g:ytmd-token',
    adminToken: 'l2g:admin-token', // sessionStorage only
    hostSecret: (roomCode) => `l2g:host-secret:${roomCode}`,
};

// Keys written by the pre-rewrite version, migrated once on startup.
export const LEGACY_STORAGE_KEYS = [
    'ytmd_token',
    'ytmd_listener_token',
    'ytmd_host_room',
    'spotify_listener_token',
];

/**
 * The room object pushed by the backend on `roomUpdated`. Mirrors
 * `toPublicRoom` in backend/src/room.js.
 *
 * @typedef {object} PublicRoom
 * @property {string}      roomCode
 * @property {string|null} trackName
 * @property {string|null} artistName
 * @property {string|null} videoId
 * @property {string|null} albumArt
 * @property {'playing'|'paused'} status
 * @property {number}      positionMs     position at `updatedAt`, server clock
 * @property {number}      durationMs     0 when unknown
 * @property {number}      updatedAt      server clock
 * @property {boolean}     hostConnected
 * @property {number}      listenerCount
 * @property {number}      serverNow      server clock at emit time
 */
export const SOCKET_EVENTS = {
    // client -> server
    joinRoom: 'joinRoom',
    updateRoom: 'updateRoom',
    // server -> client
    roomUpdated: 'roomUpdated',
    roomNotFound: 'roomNotFound',
    unauthorized: 'unauthorized',
    updateRejected: 'updateRejected',
};
