import { describe, it, expect } from 'vitest';
import { effectivePositionMs, clockOffsetFrom, formatTime, progressRatio } from './playback.js';

describe('effectivePositionMs', () => {
    it('returns 0 when room is missing', () => {
        expect(effectivePositionMs(null, 0, 1000)).toBe(0);
    });

    it('returns positionMs unchanged (floored at 0) when paused', () => {
        const room = { status: 'paused', positionMs: 5000, updatedAt: 0, durationMs: 10000 };
        expect(effectivePositionMs(room, 0, 999999)).toBe(5000);
    });

    it('advances by elapsed time while playing', () => {
        const room = { status: 'playing', positionMs: 1000, updatedAt: 0, durationMs: 1000000 };
        expect(effectivePositionMs(room, 0, 2500)).toBe(3500);
    });

    it('clamps to durationMs when playing past the end', () => {
        const room = { status: 'playing', positionMs: 9000, updatedAt: 0, durationMs: 10000 };
        expect(effectivePositionMs(room, 0, 5000)).toBe(10000);
    });

    it('does not clamp when durationMs is 0', () => {
        const room = { status: 'playing', positionMs: 9000, updatedAt: 0, durationMs: 0 };
        expect(effectivePositionMs(room, 0, 5000)).toBe(14000);
    });

    it('never goes negative even with clock skew', () => {
        const room = { status: 'playing', positionMs: 1000, updatedAt: 5000, durationMs: 10000 };
        expect(effectivePositionMs(room, 0, 0)).toBe(1000);
    });

    it('applies a non-zero clockOffsetMs to translate local time into server time', () => {
        // Local clock reads 1000, but the server's clock is 5000ms ahead of ours.
        const room = { status: 'playing', positionMs: 1000, updatedAt: 4000, durationMs: 1000000 };
        const clockOffsetMs = 5000;
        const now = 1000; // local time
        // serverNow = now + clockOffsetMs = 6000; elapsed = 6000 - 4000 = 2000
        expect(effectivePositionMs(room, clockOffsetMs, now)).toBe(3000);
    });

    it('a negative clockOffsetMs (local clock ahead of server) reduces elapsed time accordingly', () => {
        const room = { status: 'playing', positionMs: 1000, updatedAt: 4000, durationMs: 1000000 };
        const clockOffsetMs = -1000;
        const now = 6000; // serverNow = 6000 - 1000 = 5000; elapsed = 1000
        expect(effectivePositionMs(room, clockOffsetMs, now)).toBe(2000);
    });
});

describe('clockOffsetFrom', () => {
    it('returns 0 when room is missing', () => {
        expect(clockOffsetFrom(null, 1000)).toBe(0);
    });

    it('returns 0 when room.serverNow is not a number', () => {
        expect(clockOffsetFrom({ serverNow: 'nope' }, 1000)).toBe(0);
    });

    it('computes serverNow - now', () => {
        expect(clockOffsetFrom({ serverNow: 5000 }, 1000)).toBe(4000);
    });

    it('can be negative when the local clock is ahead of the server', () => {
        expect(clockOffsetFrom({ serverNow: 1000 }, 5000)).toBe(-4000);
    });
});

describe('formatTime', () => {
    it('formats 0 as 0:00', () => {
        expect(formatTime(0)).toBe('0:00');
    });

    it('formats null as 0:00', () => {
        expect(formatTime(null)).toBe('0:00');
    });

    it('formats undefined as 0:00', () => {
        expect(formatTime(undefined)).toBe('0:00');
    });

    it('formats NaN as 0:00', () => {
        expect(formatTime(NaN)).toBe('0:00');
    });

    it('formats a negative value as 0:00', () => {
        expect(formatTime(-5000)).toBe('0:00');
    });

    it('formats 102000ms as 1:42', () => {
        expect(formatTime(102000)).toBe('1:42');
    });

    it('formats 3598000ms as 59:58', () => {
        expect(formatTime(3598000)).toBe('59:58');
    });
});

describe('progressRatio', () => {
    it('returns 0 when room is missing', () => {
        expect(progressRatio(null, 0, 1000)).toBe(0);
    });

    it('returns 0 when durationMs is 0', () => {
        const room = { status: 'playing', positionMs: 1000, updatedAt: 0, durationMs: 0 };
        expect(progressRatio(room, 0, 5000)).toBe(0);
    });

    it('computes the ratio of position to duration', () => {
        const room = { status: 'paused', positionMs: 2500, updatedAt: 0, durationMs: 10000 };
        expect(progressRatio(room, 0, 5000)).toBe(0.25);
    });

    it('clamps to 1 when position would exceed duration', () => {
        const room = { status: 'playing', positionMs: 9000, updatedAt: 0, durationMs: 10000 };
        expect(progressRatio(room, 0, 5000)).toBe(1);
    });
});

describe('client/server position math agreement', () => {
    // Mirrors backend/src/room.js effectivePositionMs exactly, for comparison.
    function backendEffectivePositionMs(room, now) {
        if (room.status !== 'playing') return room.positionMs;
        const advanced = room.positionMs + Math.max(0, now - room.updatedAt);
        return room.durationMs > 0 ? Math.min(advanced, room.durationMs) : advanced;
    }

    const cases = [
        { status: 'paused', positionMs: 3000, updatedAt: 1000, durationMs: 10000, now: 9000 },
        { status: 'playing', positionMs: 3000, updatedAt: 1000, durationMs: 10000, now: 9000 },
        { status: 'playing', positionMs: 9500, updatedAt: 1000, durationMs: 10000, now: 50000 },
        { status: 'playing', positionMs: 500, updatedAt: 1000, durationMs: 0, now: 50000 },
    ];

    it('produces identical results to the backend for the same inputs with clockOffsetMs = 0', () => {
        for (const room of cases) {
            const clientResult = effectivePositionMs(room, 0, room.now);
            const serverResult = backendEffectivePositionMs(room, room.now);
            expect(clientResult).toBe(serverResult);
        }
    });
});
