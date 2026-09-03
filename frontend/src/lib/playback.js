/**
 * Pure client-side mirror of the position math in `backend/src/room.js`.
 *
 * No React, no config imports, no ambient `Date.now()` calls (only as a
 * defaulted argument) — this module must stay trivially unit-testable.
 */

/**
 * Where playback actually is right now, accounting for time elapsed since
 * the host's last push and the offset between our clock and the server's.
 *
 * MUST mirror `effectivePositionMs` in backend/src/room.js exactly:
 *   - paused  -> `positionMs` unchanged (floored at 0)
 *   - playing -> `positionMs + max(0, serverNow - updatedAt)`, clamped to
 *                `[0, durationMs]` when `durationMs > 0`, else just `>= 0`.
 * `serverNow` here is `now + clockOffsetMs`, i.e. our local clock translated
 * into the server's clock via the offset derived from `clockOffsetFrom`.
 *
 * @param {import('./config.js').PublicRoom|null} room
 * @param {number} [clockOffsetMs] server clock minus local clock, from `clockOffsetFrom`
 * @param {number} [now] local clock reading; defaulted for testability
 * @returns {number} position in milliseconds
 */
export function effectivePositionMs(room, clockOffsetMs = 0, now = Date.now()) {
    if (!room) return 0;

    if (room.status !== 'playing') {
        return Math.max(0, room.positionMs);
    }

    const serverNow = now + clockOffsetMs;
    const elapsed = Math.max(0, serverNow - room.updatedAt);
    const advanced = room.positionMs + elapsed;

    if (room.durationMs > 0) {
        return Math.min(Math.max(advanced, 0), room.durationMs);
    }
    return Math.max(advanced, 0);
}

/**
 * Derives the offset between the server's clock and ours from a freshly
 * received room push, so later calls can translate `Date.now()` into the
 * server's frame of reference without depending on wall-clock sync.
 *
 * @param {import('./config.js').PublicRoom|null} room
 * @param {number} [now] local clock reading; defaulted for testability
 * @returns {number} milliseconds to add to a local timestamp to get the
 *   equivalent server timestamp; `0` when `room` is missing.
 */
export function clockOffsetFrom(room, now = Date.now()) {
    if (!room || typeof room.serverNow !== 'number') return 0;
    return room.serverNow - now;
}

/**
 * Formats a millisecond duration as `m:ss` (no leading zero on minutes).
 * Anything non-finite, negative, null, or undefined renders as `0:00`.
 *
 * @param {number|null|undefined} ms
 * @returns {string}
 */
export function formatTime(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
        return '0:00';
    }
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The interpolated playback position as a ratio of `durationMs`, clamped to
 * `[0, 1]`. Safe (returns `0`) when duration is unknown/zero.
 *
 * @param {import('./config.js').PublicRoom|null} room
 * @param {number} [clockOffsetMs]
 * @param {number} [now]
 * @returns {number}
 */
export function progressRatio(room, clockOffsetMs = 0, now = Date.now()) {
    if (!room || !room.durationMs) return 0;
    const positionMs = effectivePositionMs(room, clockOffsetMs, now);
    return Math.min(1, Math.max(0, positionMs / room.durationMs));
}
