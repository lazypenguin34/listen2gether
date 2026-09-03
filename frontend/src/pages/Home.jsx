import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../lib/config.js';
import { requestToken, readStoredToken, storeToken } from '../lib/ytmd.js';
import { storeHostSecret } from '../lib/hostSecret.js';

export default function Home() {
    const navigate = useNavigate();
    const [hosting, setHosting] = useState(false);
    const [hostError, setHostError] = useState(null);
    const [joinCode, setJoinCode] = useState('');
    const [joinError, setJoinError] = useState(null);

    const handleHost = async () => {
        setHosting(true);
        setHostError(null);
        try {
            const token = readStoredToken() || (await requestToken());
            storeToken(token);

            const res = await fetch(`${BACKEND_URL}/createRoom`, { method: 'POST' });
            if (!res.ok) {
                throw new Error(`createRoom failed (${res.status})`);
            }
            const { roomCode, hostSecret } = await res.json();

            // Must happen before navigate(): useRoomSocket reads this key on
            // connect to decide whether to join as host or listener.
            storeHostSecret(roomCode, hostSecret);

            navigate(`/room/${roomCode}`);
        } catch (err) {
            console.error('Failed to start hosting', err);
            setHostError(
                'Could not connect to YouTube Music Desktop. Make sure the app is running, the ' +
                    'Companion Server is enabled in its settings, and you approve the pairing request ' +
                    'inside the app.'
            );
        } finally {
            setHosting(false);
        }
    };

    const handleJoin = (e) => {
        e.preventDefault();
        const code = joinCode.trim();
        if (!code) {
            setJoinError('Enter a room code.');
            return;
        }
        setJoinError(null);
        navigate(`/room/${code}`);
    };

    return (
        <div className="center-content">
            <div className="card card--narrow stack">
                <div className="stack" style={{ '--stack-gap': 'var(--space-2)' }}>
                    <h1>listen2gether</h1>
                    <p>Listen to YouTube Music in sync with friends, in real time.</p>
                </div>

                <div className="stack">
                    <h2>Host a room</h2>
                    <p>
                        Hosting requires the{' '}
                        <a href="https://github.com/ytmdesktop/ytmdesktop" target="_blank" rel="noreferrer">
                            YouTube Music Desktop app
                        </a>{' '}
                        with its Companion Server enabled. Your local playback becomes the room's source
                        of truth.
                    </p>
                    <button type="button" className="btn btn--brand" onClick={handleHost} disabled={hosting}>
                        {hosting ? 'Connecting…' : 'Host a room'}
                    </button>
                    {hostError && <div className="alert alert--error">{hostError}</div>}
                </div>

                <div className="stack">
                    <h2>Join with a code</h2>
                    <p>
                        Anyone can join and watch what's playing. Syncing your own playback also needs the
                        desktop app — you'll be prompted to connect it once you're in the room.
                    </p>
                    <form className="stack" onSubmit={handleJoin}>
                        <div className="field">
                            <label htmlFor="join-code">Room code</label>
                            <input
                                id="join-code"
                                className="input code-input"
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={4}
                                autoFocus
                                value={joinCode}
                                onChange={(e) => setJoinCode(e.target.value)}
                                placeholder="0000"
                            />
                        </div>
                        {joinError && <div className="alert alert--error">{joinError}</div>}
                        <button type="submit" className="btn btn--primary">
                            Join room
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
