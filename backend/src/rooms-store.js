'use strict';

/**
 * Lifecycle management for the in-memory `rooms` Map. There is no database —
 * rooms live only as long as the process and are swept periodically so a
 * flood of abandoned rooms can't grow the Map without bound.
 */

const SWEEP_INTERVAL_MS = 60 * 1000;

// A room with no activity (host update or listener join) in this long is dead.
const ROOM_MAX_IDLE_MS = 2 * 60 * 60 * 1000; // 2 hours

// A room whose host never pushed a single update (updatedAt === createdAt)
// is almost certainly an abandoned "create and never joined" room; give it a
// grace period rather than the full idle window.
const ROOM_ABANDONED_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Deletes rooms that are idle or abandoned. Exported standalone (rather than
 * only via startSweeper) so it can be called directly and synchronously.
 */
function sweepRooms(rooms, now = Date.now()) {
    let evicted = 0;
    for (const [roomCode, room] of rooms) {
        const idle = now - room.lastSeenAt > ROOM_MAX_IDLE_MS;
        const abandoned = room.updatedAt === room.createdAt && now - room.createdAt > ROOM_ABANDONED_MS;

        if (idle || abandoned) {
            rooms.delete(roomCode);
            evicted += 1;
            console.log(`[rooms] evicted room ${roomCode} (${idle ? 'idle' : 'abandoned'})`);
        }
    }
    return evicted;
}

/** Starts the periodic sweep. `.unref()`'d so it never holds the process (or a test) open. */
function startSweeper(rooms, intervalMs = SWEEP_INTERVAL_MS) {
    const interval = setInterval(() => sweepRooms(rooms), intervalMs);
    interval.unref();
    return interval;
}

module.exports = {
    SWEEP_INTERVAL_MS,
    ROOM_MAX_IDLE_MS,
    ROOM_ABANDONED_MS,
    sweepRooms,
    startSweeper,
};
