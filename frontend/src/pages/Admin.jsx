import { useEffect, useState } from 'react';
import axios from 'axios';

export default function Admin() {
    const [rooms, setRooms] = useState({ spotify: [], yt: [] });
    const [error, setError] = useState(null);

    useEffect(() => {
        const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8888';

        const fetchRooms = async () => {
            try {
                const res = await axios.get(`${BACKEND_URL}/getRooms`);
                setRooms(res.data);
                setError(null);
            } catch (err) {
                setError('Failed to fetch rooms from backend.');
            }
        };

        fetchRooms();
        const interval = setInterval(fetchRooms, 3000);
        return () => clearInterval(interval);
    }, []);

    const renderTable = (roomList, type) => (
        <table className="rooms-table glass-panel">
            <thead>
                <tr>
                    <th>Room Code</th>
                    <th>Track</th>
                    <th>Artist</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                {roomList.length === 0 ? (
                    <tr>
                        <td colSpan="4" style={{ textAlign: 'center', opacity: 0.5 }}>No active {type} rooms</td>
                    </tr>
                ) : (
                    roomList.map(room => (
                        <tr key={room.roomCode}>
                            <td style={{ fontWeight: 800 }}>{room.roomCode}</td>
                            <td>{room.trackName || '-'}</td>
                            <td>{room.artistName || '-'}</td>
                            <td>
                                <span className={`badge ${room.status}`}>{room.status}</span>
                            </td>
                        </tr>
                    ))
                )}
            </tbody>
        </table>
    );

    return (
        <div className="admin-container container">
            <h1>Admin Panel</h1>
            {error && <p style={{ color: 'var(--youtube-hover)' }}>{error}</p>}
            
            <h2 style={{ marginTop: '2rem' }}>Spotify Rooms</h2>
            {renderTable(rooms.spotify, 'Spotify')}

            <h2 style={{ marginTop: '2rem' }}>YouTube Music Rooms</h2>
            {renderTable(rooms.yt, 'YouTube Music')}
        </div>
    );
}
