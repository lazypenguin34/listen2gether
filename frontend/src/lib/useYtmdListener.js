/**
 * Keeps a listener's local YTMD player in sync with the room: polls local
 * playback state, then periodically issues corrective commands (change
 * video / play / pause / seek) to converge on the host's interpolated
 * position.
 */

import { useEffect, useRef, useState } from 'react';
import { LISTENER_POLL_INTERVAL_MS, LISTENER_CONTROL_INTERVAL_MS, DRIFT_TOLERANCE_MS } from './config.js';
import { getState, changeVideo, play, pause, seekTo, clearToken } from './ytmd.js';
import { effectivePositionMs } from './playback.js';

/**
 * @param {object} params
 * @param {import('./config.js').PublicRoom|null} params.room
 * @param {number} params.clockOffsetMs
 * @param {string|null} params.token     YTMD auth token for this listener
 * @param {boolean} params.enabled       whether this client should actively sync
 * @returns {{ syncing: boolean, error: string|null }} `syncing` means "we
 *   have successfully polled local YTMD state at least once since being
 *   enabled" (a confirmed connection), not merely "configured to sync" -
 *   it only ever flips true from inside the poll callback, so it doesn't
 *   report success before the first response actually arrives.
 */
export function useYtmdListener({ room, clockOffsetMs, token, enabled }) {
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState(null);

    // The control loop reads these every 1.5s but must not restart just
    // because the room object or offset changed identity, so they're
    // threaded through refs. React 19 forbids writing refs during render
    // (a render can be discarded, or double-run under StrictMode), so the
    // writes live in their own effects, declared ahead of the polling
    // effect below - effects commit in declaration order, so both refs are
    // current before the loop can ever read them.
    const roomRef = useRef(room);
    useEffect(() => {
        roomRef.current = room;
    }, [room]);

    const clockOffsetRef = useRef(clockOffsetMs);
    useEffect(() => {
        clockOffsetRef.current = clockOffsetMs;
    }, [clockOffsetMs]);

    useEffect(() => {
        if (!enabled || !token) {
            // No `setSyncing(false)` here on purpose: writing state
            // synchronously in the effect body trips react-hooks/set-state-
            // in-effect, and `syncing`'s useState(false) initializer already
            // covers "never enabled yet". NOTE: this means `syncing` does
            // NOT reset to false if this hook goes from enabled+synced back
            // to disabled without unmounting (e.g. a listener token is
            // cleared while the component stays mounted) - it stays stuck
            // at its last value until the hook is remounted. Callers that
            // toggle `enabled` on a long-lived instance should treat
            // `enabled === false` as the authoritative "not syncing" signal
            // rather than relying on `syncing` alone.
            return undefined;
        }

        let pollId;
        let controlId;

        // Local YTMD snapshot, optimistically mutated between polls so the
        // fast control loop doesn't re-issue the same command while
        // waiting on the next slow poll.
        let local = null;

        const stop = () => {
            clearInterval(pollId);
            clearInterval(controlId);
        };

        const handleAuthFailure = () => {
            clearToken();
            setSyncing(false);
            setError('YTMD authorization expired. Reconnect to resume syncing.');
            stop();
        };

        const poll = async () => {
            try {
                local = await getState(token);
                setSyncing(true);
                setError(null);
            } catch (err) {
                if (err?.status === 401) {
                    handleAuthFailure();
                    return;
                }
                setError('Could not reach YTMD.');
            }
        };

        const control = async () => {
            if (!local) return;
            const currentRoom = roomRef.current;
            if (!currentRoom) return;

            try {
                // 1. Track change takes priority; wait a tick before
                // touching play state or position on the new track.
                if (currentRoom.videoId && local.videoId !== currentRoom.videoId) {
                    await changeVideo(token, currentRoom.videoId);
                    local = { ...local, videoId: currentRoom.videoId };
                    return;
                }

                // 2. Reconcile play/pause.
                const localPlaying = local.status === 'playing';
                const roomPlaying = currentRoom.status === 'playing';
                if (roomPlaying !== localPlaying) {
                    if (roomPlaying) {
                        await play(token);
                    } else {
                        await pause(token);
                    }
                    local = { ...local, status: currentRoom.status, polledAt: Date.now() };
                }

                // 3. Reconcile position, interpolating both sides so a
                // slow poll cadence doesn't look like drift.
                if (currentRoom.status === 'playing') {
                    const localMs = local.positionMs + (local.status === 'playing' ? Date.now() - local.polledAt : 0);
                    const hostMs = effectivePositionMs(currentRoom, clockOffsetRef.current);

                    if (Math.abs(localMs - hostMs) > DRIFT_TOLERANCE_MS) {
                        const maxMs = local.durationMs > 0 ? local.durationMs : hostMs;
                        const targetMs = Math.max(0, Math.min(hostMs, maxMs));
                        await seekTo(token, Math.floor(targetMs / 1000));
                        local = { ...local, positionMs: targetMs, polledAt: Date.now() };
                    }
                }
            } catch (err) {
                if (err?.status === 401) {
                    handleAuthFailure();
                    return;
                }
                setError('Could not send command to YTMD.');
            }
        };

        poll();
        pollId = setInterval(poll, LISTENER_POLL_INTERVAL_MS);
        controlId = setInterval(control, LISTENER_CONTROL_INTERVAL_MS);

        return stop;
    }, [enabled, token]);

    return { syncing, error };
}
