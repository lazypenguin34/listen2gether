import { useEffect, useState } from 'react';
import { BACKEND_URL, ADMIN_POLL_INTERVAL_MS, STORAGE_KEYS } from '../lib/config.js';

function readStoredAdminToken() {
    try {
        return sessionStorage.getItem(STORAGE_KEYS.adminToken);
    } catch {
        return null;
    }
}

function storeAdminToken(token) {
    try {
        sessionStorage.setItem(STORAGE_KEYS.adminToken, token);
    } catch {
        // ignore
    }
}

function clearAdminToken() {
    try {
        sessionStorage.removeItem(STORAGE_KEYS.adminToken);
    } catch {
        // ignore
    }
}

export default function Admin() {
    const [token, setToken] = useState(() => readStoredAdminToken());
    const [tokenInput, setTokenInput] = useState('');
    const [rooms, setRooms] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!token) return undefined;

        let cancelled = false;

        const fetchRooms = async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/getRooms`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (cancelled) return;

                if (res.status === 401) {
                    clearAdminToken();
                    setToken(null);
                    setError('That token was rejected. Enter the admin token again.');
                    return;
                }
                if (res.status === 503) {
                    setError('ADMIN_TOKEN is not configured on the server, so this endpoint is disabled.');
                    return;
                }
                if (!res.ok) {
                    throw new Error(`getRooms failed (${res.status})`);
                }

                const data = await res.json();
                setRooms(data.rooms || []);
                setError(null);
            } catch (err) {
                if (!cancelled) {
                    console.error('Failed to fetch rooms', err);
                    setError('Failed to fetch rooms from backend.');
                }
            }
        };

        fetchRooms();
        const interval = setInterval(fetchRooms, ADMIN_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [token]);

    if (!token) {
        return (
            <div className="center-content">
                <div className="card card--narrow stack">
                    <h1>Admin</h1>
                    <form
                        className="stack"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const trimmed = tokenInput.trim();
                            if (!trimmed) return;
                            storeAdminToken(trimmed);
                            setToken(trimmed);
                            setTokenInput('');
                        }}
                    >
                        <div className="field">
                            <label htmlFor="admin-token">Admin token</label>
                            <input
                                id="admin-token"
                                className="input"
                                type="password"
                                value={tokenInput}
                                onChange={(e) => setTokenInput(e.target.value)}
                                autoFocus
                            />
                        </div>
                        {error && <div className="alert alert--error">{error}</div>}
                        <button type="submit" className="btn btn--primary">
                            Continue
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <h1>Admin</h1>
            {error && <div className="alert alert--error">{error}</div>}
            <table className="table">
                <thead>
                    <tr>
                        <th>Room Code</th>
                        <th>Track</th>
                        <th>Artist</th>
                        <th>Status</th>
                        <th>Host</th>
                        <th>Listeners</th>
                    </tr>
                </thead>
                <tbody>
                    {rooms.length === 0 ? (
                        <tr>
                            <td colSpan={6}>No active rooms</td>
                        </tr>
                    ) : (
                        rooms.map((room) => (
                            <tr key={room.roomCode}>
                                <td>{room.roomCode}</td>
                                <td>{room.trackName || '-'}</td>
                                <td>{room.artistName || '-'}</td>
                                <td>{room.status}</td>
                                <td>{room.hostConnected ? 'Connected' : 'Disconnected'}</td>
                                <td>{room.listenerCount}</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
