import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Home() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [joinCode, setJoinCode] = useState('');

    const handleJoin = (e) => {
        e.preventDefault();
        if (joinCode.trim()) {
            navigate(`/room/${joinCode.trim()}`);
        }
    };

    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8888';

    const handleSpotifyLogin = () => {
        window.location.href = `${BACKEND_URL}/spotifyLogin`;
    };

    const handleYoutubeLogin = async () => {
        try {
            setLoading(true);
            setError('');
            // 1. Request Code from YTMD
            const codeRes = await axios.post('http://localhost:9863/api/v1/auth/requestcode', {
                appId: 'listen2gether',
                appName: 'listen2gether',
                appVersion: '2.0.0',
            });
            const { code } = codeRes.data;

            // 2. Request Token
            // According to docs, user has to approve on YTMD interface.
            // If it succeeds, it gives a token.
            const tokenRes = await axios.post('http://localhost:9863/api/v1/auth/request', {
                appId: 'listen2gether',
                code: code,
            });
            const { token } = tokenRes.data;

            // Save token locally
            localStorage.setItem('ytmd_token', token);

            // 3. Create Room on our Backend
            const backendRes = await axios.post(`${BACKEND_URL}/createYTRoom`);
            const roomCode = backendRes.data.roomCode;
            
            // Mark this tab as the "host" of ytmd
            localStorage.setItem('ytmd_host_room', roomCode);

            // 4. Redirect to room view
            navigate(`/room/${roomCode}`);
        } catch (err) {
            console.error('YTMD Connection Error:', err);
            setError('Failed to connect to Youtube Music Desktop Companion Server. Make sure it is running and the Companion Server is enabled.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="center-content">
            <div className="glass-panel login-card">
                <h2>Welcome to listen2gether</h2>
                <p>Start a listening party and share your music with friends in real-time.</p>
                
                {error && <p style={{ color: 'var(--youtube-hover)', fontWeight: 'bold' }}>{error}</p>}

                <div className="login-options">
                    <button className="btn-spotify" onClick={handleSpotifyLogin}>
                        Host with Spotify (Premium)
                    </button>
                    <button className="btn-youtube" onClick={handleYoutubeLogin} disabled={loading}>
                        {loading ? 'Connecting...' : 'Host with YT Music Desktop'}
                    </button>
                </div>
                
                <div style={{ margin: '2rem 0', opacity: 0.5 }}>— OR —</div>
                
                <form onSubmit={handleJoin} style={{ display: 'flex', gap: '0.5rem' }}>
                    <input 
                        type="text" 
                        placeholder="Enter Room Code" 
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value)}
                        required
                    />
                    <button type="submit" style={{ background: 'var(--surface-border)' }}>Join</button>
                </form>
            </div>
        </div>
    );
}
