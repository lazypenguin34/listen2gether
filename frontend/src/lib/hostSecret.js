/**
 * Single point of access for the per-room host secret in localStorage.
 * `STORAGE_KEYS.hostSecret(roomCode)` must never be read or written
 * anywhere else, so that there is exactly one implementation to keep in
 * step with `config.js`.
 */

import { STORAGE_KEYS } from './config.js';

/**
 * @param {string} roomCode
 * @returns {string|null} the stored host secret for this room, or `null` if
 *   absent or if storage is unavailable (e.g. Safari private mode throws on
 *   access).
 */
export function readHostSecret(roomCode) {
    try {
        return localStorage.getItem(STORAGE_KEYS.hostSecret(roomCode));
    } catch {
        return null;
    }
}

/**
 * @param {string} roomCode
 * @param {string} secret
 * @returns {void}
 */
export function storeHostSecret(roomCode, secret) {
    try {
        localStorage.setItem(STORAGE_KEYS.hostSecret(roomCode), secret);
    } catch {
        // ignore write failures (private mode / storage full)
    }
}

/**
 * @param {string} roomCode
 * @returns {void}
 */
export function clearHostSecret(roomCode) {
    try {
        localStorage.removeItem(STORAGE_KEYS.hostSecret(roomCode));
    } catch {
        // ignore
    }
}
