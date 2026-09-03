/**
 * Owns the socket.io lifecycle for a room: connecting, joining (as host or
 * listener), and keeping the local room snapshot + derived clock offset in
 * sync with the server's `roomUpdated` pushes.
 *
 * REQUIRES REMOUNT ON ROOM CHANGE: this hook does not reset `room`,
 * `listenerCount`, `notFound`, `connected`, `clockOffsetMs`, `error`, or
 * `socket` when `roomCode` changes under an already-mounted caller - it
 * relies on the consumer remounting the component that calls it whenever
 * the room changes (e.g. a route keyed by `roomCode`, so every `useState`
 * here gets a fresh initializer). Calling this hook with a changing
 * `roomCode` on a component that does NOT remount will leak the previous
 * room's state into the new room until the next `roomUpdated` push
 * overwrites it.
 */

import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { BACKEND_URL, SOCKET_EVENTS } from './config.js';
import { clockOffsetFrom } from './playback.js';
import { readHostSecret } from './hostSecret.js';

/**
 * @param {string|undefined} roomCode
 * @returns {{
 *   room: import('./config.js').PublicRoom|null,
 *   listenerCount: number,
 *   notFound: boolean,
 *   connected: boolean,
 *   clockOffsetMs: number,
 *   socket: import('socket.io-client').Socket|null,
 *   error: string|null,
 * }}
 */
export function useRoomSocket(roomCode) {
    const [room, setRoom] = useState(null);
    const [listenerCount, setListenerCount] = useState(0);
    const [notFound, setNotFound] = useState(false);
    const [connected, setConnected] = useState(false);
    const [clockOffsetMs, setClockOffsetMs] = useState(0);
    const [error, setError] = useState(null);
    const [socket, setSocket] = useState(null);

    useEffect(() => {
        if (!roomCode) return undefined;

        const s = io(BACKEND_URL);

        // `roomCode` is a plain closure variable, not a ref: this whole
        // effect (and every handler declared inside it) is torn down and
        // recreated whenever `roomCode` changes, since it's in the deps
        // array below - so it can never go stale.
        //
        // `setSocket(s)` deliberately happens HERE, inside the 'connect'
        // callback, rather than immediately after `io(...)` above: this
        // eslint config's react-hooks/set-state-in-effect flags any setState
        // call written directly in an effect's synchronous body (it does not
        // special-case "expose a freshly created resource"), and only
        // permits setState from inside a callback responding to an external
        // event - exactly what 'connect' is. It also means consumers only
        // ever see a `socket` that is actually connected, which is the more
        // useful contract anyway (emitting before then would be premature).
        const handleConnect = () => {
            setSocket(s);
            setConnected(true);
            const hostSecret = readHostSecret(roomCode);
            s.emit(SOCKET_EVENTS.joinRoom, hostSecret ? { roomCode, hostSecret } : { roomCode });
        };

        const handleDisconnect = () => {
            setConnected(false);
        };

        const handleRoomUpdated = (updatedRoom) => {
            setRoom(updatedRoom);
            setListenerCount(updatedRoom?.listenerCount ?? 0);
            setClockOffsetMs(clockOffsetFrom(updatedRoom));
            setNotFound(false);
            setError(null);
        };

        const handleRoomNotFound = () => {
            setNotFound(true);
        };

        const handleUnauthorized = () => {
            setError('unauthorized');
        };

        const handleUpdateRejected = (payload) => {
            setError(payload?.error || 'updateRejected');
        };

        s.on('connect', handleConnect);
        s.on('disconnect', handleDisconnect);
        s.on(SOCKET_EVENTS.roomUpdated, handleRoomUpdated);
        s.on(SOCKET_EVENTS.roomNotFound, handleRoomNotFound);
        s.on(SOCKET_EVENTS.unauthorized, handleUnauthorized);
        s.on(SOCKET_EVENTS.updateRejected, handleUpdateRejected);

        return () => {
            s.off('connect', handleConnect);
            s.off('disconnect', handleDisconnect);
            s.off(SOCKET_EVENTS.roomUpdated, handleRoomUpdated);
            s.off(SOCKET_EVENTS.roomNotFound, handleRoomNotFound);
            s.off(SOCKET_EVENTS.unauthorized, handleUnauthorized);
            s.off(SOCKET_EVENTS.updateRejected, handleUpdateRejected);
            s.close();
        };
    }, [roomCode]);

    return { room, listenerCount, notFound, connected, clockOffsetMs, socket, error };
}
