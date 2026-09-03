/**
 * Polls the local YTMD companion app on behalf of the room's host and
 * pushes diffs to the room via the socket whenever something a listener
 * would care about actually changed.
 */

import { useEffect, useRef, useState } from 'react';
import { HOST_POLL_INTERVAL_MS, HOST_HEARTBEAT_MS, SEEK_TOLERANCE_MS, SOCKET_EVENTS } from './config.js';
import { getState } from './ytmd.js';

/**
 * @param {object} params
 * @param {string|null} params.roomCode
 * @param {string|null} params.hostSecret
 * @param {import('socket.io-client').Socket|null} params.socket
 * @param {string|null} params.token      YTMD auth token for this host
 * @param {boolean} params.enabled        whether this client should actively host
 * @returns {{ error: string|null, reachable: boolean }}
 */
export function useYtmdHost({ roomCode, hostSecret, socket, token, enabled }) {
    const [error, setError] = useState(null);
    const [reachable, setReachable] = useState(true);

    // The poll loop reads `socket` but must not restart when its identity
    // changes, so it's threaded through a ref. React 19 forbids writing
    // refs during render (a render can be discarded, or double-run under
    // StrictMode), so the write itself lives in its own effect, declared
    // ahead of the polling effect below - effects commit in declaration
    // order, so the ref is current before the loop can ever read it.
    const socketRef = useRef(socket);
    useEffect(() => {
        socketRef.current = socket;
    }, [socket]);

    useEffect(() => {
        if (!enabled || !roomCode || !hostSecret || !token) return undefined;

        let cancelled = false;
        let unreachable = false;

        // Last snapshot actually observed from YTMD (every poll tick).
        let last = { status: null, videoId: null, positionMs: 0, at: Date.now() };
        // Last snapshot actually pushed to the server (used to diff which
        // metadata fields are worth re-sending).
        let lastEmitted = { videoId: undefined, trackName: undefined, artistName: undefined, albumArt: undefined };
        let lastEmitAt = 0;

        const poll = async () => {
            let state;
            try {
                state = await getState(token);
            } catch (err) {
                if (!unreachable) {
                    unreachable = true;
                    setReachable(false);
                    setError('YTMD companion app unreachable.');
                    console.error('YTMD host: companion app unreachable; will keep retrying silently.', err);
                }
                return;
            }
            if (cancelled) return;

            if (unreachable) {
                unreachable = false;
                setReachable(true);
                setError(null);
            }

            const now = Date.now();
            const { positionMs, durationMs, trackName, artistName, albumArt, videoId } = state;

            // A buffering blip must not read to listeners as a pause, and
            // must never reach the server as anything but 'playing'/'paused'
            // (parseRoomUpdate 400s the whole payload otherwise). `last.status`
            // is always itself a coerced value (or the initial `null`), so by
            // induction `status` here can only ever be 'playing' or 'paused'.
            const status = state.status === 'buffering' ? (last.status ?? 'paused') : state.status;

            const expected = last.positionMs + (last.status === 'playing' ? now - last.at : 0);
            const isSeek = Math.abs(positionMs - expected) > SEEK_TOLERANCE_MS;
            const shouldEmit =
                isSeek ||
                status !== last.status ||
                videoId !== last.videoId ||
                now - lastEmitAt >= HOST_HEARTBEAT_MS;

            last = { status, videoId, positionMs, at: now };

            if (!shouldEmit) return;

            // Always send position/status/duration so the server's
            // timestamp - and the progress bar it implies - stays
            // meaningful; only re-send metadata that actually changed.
            const fields = { positionMs, status, durationMs };
            if (videoId !== lastEmitted.videoId) fields.videoId = videoId;
            if (trackName !== lastEmitted.trackName) fields.trackName = trackName;
            if (artistName !== lastEmitted.artistName) fields.artistName = artistName;
            if (albumArt !== lastEmitted.albumArt) fields.albumArt = albumArt;

            lastEmitted = { videoId, trackName, artistName, albumArt };
            lastEmitAt = now;
            setError(null);
            socketRef.current?.emit(SOCKET_EVENTS.updateRoom, { roomCode, hostSecret, ...fields });
        };

        poll();
        const intervalId = setInterval(poll, HOST_POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(intervalId);
        };
    }, [enabled, roomCode, hostSecret, token]);

    return { error, reachable };
}
