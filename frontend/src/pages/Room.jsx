import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useRoomSocket } from '../lib/useRoomSocket.js';
import { useYtmdHost } from '../lib/useYtmdHost.js';
import { useYtmdListener } from '../lib/useYtmdListener.js';
import { readHostSecret } from '../lib/hostSecret.js';
import { readStoredToken } from '../lib/ytmd.js';
import AmbientBackdrop from '../components/AmbientBackdrop.jsx';
import AlbumArt from '../components/AlbumArt.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import StatusPill from '../components/StatusPill.jsx';
import RoomCode from '../components/RoomCode.jsx';
import ConnectYtmd from '../components/ConnectYtmd.jsx';

export default function Room() {
    const { roomCode } = useParams();
    const { room, listenerCount, notFound, connected, clockOffsetMs, socket } = useRoomSocket(roomCode);

    // Host-ness comes from possession of the room's host secret, not from a
    // client-asserted query param — only whoever created the room (or has
    // localStorage from that browser) ever has this.
    const hostSecret = useMemo(() => readHostSecret(roomCode), [roomCode]);
    const isHost = hostSecret !== null;

    const [ytmdToken, setYtmdToken] = useState(() => readStoredToken());

    const { error: hostError } = useYtmdHost({
        roomCode,
        hostSecret,
        socket,
        token: ytmdToken,
        enabled: isHost,
    });

    const { syncing, error: listenerError } = useYtmdListener({
        room,
        clockOffsetMs,
        token: ytmdToken,
        enabled: !isHost && !!ytmdToken,
    });

    if (notFound) {
        return (
            <div className="center-content">
                <div className="card stack">
                    <h1>Room {roomCode} doesn't exist</h1>
                    <p>It may have ended, or the code might be wrong.</p>
                    <Link className="btn btn--primary" to="/">
                        Back home
                    </Link>
                </div>
            </div>
        );
    }

    if (!room) {
        return (
            <div className="spinner-wrap">
                <div className="spinner" role="status" aria-label="Loading room" />
            </div>
        );
    }

    return (
        <div className="center-content">
            <AmbientBackdrop albumArt={room.albumArt} />
            <div className="container stack" style={{ '--stack-gap': 'var(--space-5)' }}>
                {!connected && (
                    <div className="alert alert--error" role="status">
                        Reconnecting…
                    </div>
                )}

                <div className="now-playing card" aria-live="polite">
                    <AlbumArt src={room.albumArt} alt={room.trackName ? `${room.trackName} album art` : 'No track playing'} />
                    <h1 className="track-title">{room.trackName || 'Nothing playing'}</h1>
                    <p className="track-artist">{room.artistName || ''}</p>
                    <ProgressBar room={room} clockOffsetMs={clockOffsetMs} />
                    <div className="meta-row">
                        <StatusPill status={room.status} hostConnected={room.hostConnected} />
                        <span>{listenerCount} connected</span>
                        <RoomCode roomCode={roomCode} />
                    </div>
                </div>

                {isHost ? (
                    <div className="card stack">
                        <p>You're broadcasting your YouTube Music playback to this room.</p>
                        {hostError && <div className="alert alert--error">{hostError}</div>}
                    </div>
                ) : (
                    <div className="card">
                        {ytmdToken ? (
                            <p>{syncing ? 'Synchronizing playback' : 'Connecting to YTMD…'}</p>
                        ) : (
                            <ConnectYtmd onConnected={setYtmdToken} />
                        )}
                        {listenerError && <div className="alert alert--error">{listenerError}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
