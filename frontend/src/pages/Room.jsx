import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { io } from 'socket.io-client';

export default function Room() {
    const { roomCode } = useParams();
    const [room, setRoom] = useState(null);
    const [error, setError] = useState(null);

    const [isHost, setIsHost] = useState(false);
    const [spotifyListenerToken, setSpotifyListenerToken] = useState(localStorage.getItem('spotify_listener_token'));
    const [ytmdListenerToken, setYtmdListenerToken] = useState(localStorage.getItem('ytmd_listener_token'));
    const [listenerPending, setListenerPending] = useState(false);
    const [socket, setSocket] = useState(null);

    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8888';

    // Socket setup
    useEffect(() => {
        const newSocket = io(BACKEND_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => {
            newSocket.emit('joinRoom', roomCode);
        });

        newSocket.on('roomUpdated', (updatedRoom) => {
            setRoom(updatedRoom);
            setError(null);
        });

        newSocket.on('disconnect', () => {
            // Optional: Handle disconnect visually
        });

        return () => newSocket.close();
    }, [BACKEND_URL, roomCode]);

    // Initial Params Setup
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);

        if (params.get('host') === 'true' || localStorage.getItem('ytmd_host_room') === roomCode) {
            setIsHost(true);
        }

        const sToken = params.get('listenerToken');
        if (sToken) {
            localStorage.setItem('spotify_listener_token', sToken);
            setSpotifyListenerToken(sToken);
        }

        // Clean url
        if (params.has('host') || params.has('listenerToken')) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, [roomCode]);

    // If we are the YTMD host, we need to poll the local YTMD server and update the backend via socket
    useEffect(() => {
        const _isHost = localStorage.getItem('ytmd_host_room') === roomCode;
        const ytmdToken = localStorage.getItem('ytmd_token');

        if (!_isHost || !socket) return;

        console.log('Running as YT Host!');

        let lastState = {
            status: null,
            trackName: null,
            videoId: null,
            positionMs: 0
        };

        let interval;
        const pollYTMD = async () => {
            try {
                // Fetch state from YTMD Companion
                const res = await axios.get('http://localhost:9863/api/v1/state', {
                    headers: { 'Authorization': ytmdToken }
                });

                const state = res.data;
                const status = state.player.trackState === 1 ? 'playing' : 'paused';
                const positionMs = state.player.videoProgress * 1000;
                const trackName = state.video.title;
                const artistName = state.video.author;
                const albumArt = state.video.thumbnails && state.video.thumbnails[0] ? state.video.thumbnails[0].url : null;
                const videoId = state.video.id; // Added target videoID

                // State diffing
                const isSeek = Math.abs(positionMs - lastState.positionMs) > 3000;
                const hasChanged = status !== lastState.status ||
                    videoId !== lastState.videoId ||
                    isSeek;

                lastState = { status, trackName, videoId, positionMs };

                if (hasChanged) {
                    // Push to our backend via Socket
                    socket.emit('updateYTRoom', {
                        roomCode, status, positionMs, trackName, artistName, albumArt, videoId
                    });
                }
            } catch (err) {
                console.error("Failed to poll YTMD API", err);
            }
        };

        interval = setInterval(pollYTMD, 5500);
        return () => clearInterval(interval);
    }, [roomCode, socket]);


    // YTMD Listener Sync Logic
    useEffect(() => {
        if (!room || room.type !== 'youtube' || isHost || !ytmdListenerToken) return;

        let localState = null;

        const pollState = async () => {
            try {
                const res = await axios.get('http://localhost:9863/api/v1/state', {
                    headers: { 'Authorization': ytmdListenerToken }
                });
                localState = res.data;
            } catch (err) {
                console.error("YTMD Listener Sync Error", err);
                if (err.response) {
                    console.error("YTMD API Response Error Details:", err.response.data);
                }

                if (err.response && err.response.status === 401) {
                    setYtmdListenerToken(null);
                    localStorage.removeItem('ytmd_listener_token');
                }
            }
        };

        const controlPlayer = async () => {
            if (!localState) return;

            try {
                // Sync track
                if (room.videoId && localState.video.id !== room.videoId) {
                    await axios.post('http://localhost:9863/api/v1/command', {
                        command: 'changeVideo', data: { videoId: room.videoId }
                    }, { headers: { 'Authorization': ytmdListenerToken } });
                    return; // Wait for next tick to adjust position
                }

                // Sync play/pause
                const localStatus = localState.player.trackState === 1 ? 'playing' : 'paused';
                if (room.status !== localStatus) {
                    await axios.post('http://localhost:9863/api/v1/command', {
                        command: room.status === 'playing' ? 'play' : 'pause'
                    }, { headers: { 'Authorization': ytmdListenerToken } });
                }

                // Sync position if desynced by > 3s
                if (room.status === 'playing') {
                    const localSeconds = localState.player.videoProgress;
                    const hostSeconds = room.positionMs / 1000;
                    if (Math.abs(localSeconds - hostSeconds) > 3) {
                        const safeHostSeconds = Math.min(Math.floor(hostSeconds), localState.video.durationSeconds || 0);
                        await axios.post('http://localhost:9863/api/v1/command', {
                            command: 'seekTo', data: Math.max(0, safeHostSeconds)
                        }, { headers: { 'Authorization': ytmdListenerToken } });
                    }
                }
            } catch (err) {
                console.error("YTMD Listener Command Error", err);
            }
        };

        pollState(); // initial poll

        const pollInterval = setInterval(pollState, 5500);
        const controlInterval = setInterval(controlPlayer, 1500);

        return () => {
            clearInterval(pollInterval);
            clearInterval(controlInterval);
        };
    }, [room, isHost, ytmdListenerToken]);


    // Spotify Listener Sync Logic
    useEffect(() => {
        if (!room || room.type !== 'spotify' || isHost || !spotifyListenerToken) return;

        const syncSpotify = async () => {
            try {
                const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
                    headers: { 'Authorization': `Bearer ${spotifyListenerToken}` }
                });

                if (res.status === 401) {
                    // Token expired
                    setSpotifyListenerToken(null);
                    localStorage.removeItem('spotify_listener_token');
                    return;
                }

                let localUri = null;
                let localStatus = 'paused';
                let localProgress = 0;

                if (res.status === 200) {
                    const data = await res.json();
                    if (data && data.item) {
                        localUri = data.item.uri;
                        localStatus = data.is_playing ? 'playing' : 'paused';
                        localProgress = data.progress_ms;
                    }
                }

                const headers = {
                    'Authorization': `Bearer ${spotifyListenerToken}`,
                    'Content-Type': 'application/json'
                };

                if (room.trackUri && localUri !== room.trackUri) {
                    await fetch('https://api.spotify.com/v1/me/player/play', {
                        method: 'PUT',
                        headers,
                        body: JSON.stringify({ uris: [room.trackUri], position_ms: room.positionMs })
                    });
                    return; // Next tick will handle further syncs
                }

                if (room.status !== localStatus) {
                    if (room.status === 'playing') {
                        await fetch('https://api.spotify.com/v1/me/player/play', { method: 'PUT', headers });
                    } else {
                        await fetch('https://api.spotify.com/v1/me/player/pause', { method: 'PUT', headers });
                    }
                }

                if (room.status === 'playing') {
                    if (Math.abs(localProgress - room.positionMs) > 3000) {
                        await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${room.positionMs}`, { method: 'PUT', headers });
                    }
                }

            } catch (err) {
                console.error("Spotify Listener Sync Error", err);
            }
        };

        const interval = setInterval(syncSpotify, 1000);
        return () => clearInterval(interval);
    }, [room, isHost, spotifyListenerToken]);


    // Handlers
    const handleSpotifyListenerLogin = () => {
        window.location.href = `${BACKEND_URL}/spotifyLogin?joinRoom=${roomCode}`;
    };

    const handleYTMDListenerLogin = async () => {
        try {
            setListenerPending(true);
            const codeRes = await axios.post('http://localhost:9863/api/v1/auth/requestcode', {
                appId: 'listen2gether',
                appName: 'listen2gether',
                appVersion: '2.0.0',
            });
            const { code } = codeRes.data;

            const tokenRes = await axios.post('http://localhost:9863/api/v1/auth/request', {
                appId: 'listen2gether',
                code: code,
            });
            const { token } = tokenRes.data;
            localStorage.setItem('ytmd_listener_token', token);
            setYtmdListenerToken(token);
        } catch (err) {
            console.error('Failed YTMD listener auth', err);
            alert("Could not connect to YTMD. Did you approve the request inside the Desktop App? (Check the YTMD Desktop program)");
        } finally {
            setListenerPending(false);
        }
    };

    if (error) {
        return (
            <div className="center-content">
                <div className="glass-panel login-card">
                    <h2>Error</h2>
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    if (!room) {
        return <div className="spinner"></div>;
    }

    return (
        <div className="room-container glass-panel" style={{ minWidth: '400px' }}>
            {room.albumArt ? (
                <img src={room.albumArt} alt="Album Art" className="album-art" />
            ) : (
                <div className="album-art" style={{ background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ color: '#888' }}>No Art</span>
                </div>
            )}

            <div className="track-info">
                <h1 className="track-title">{room.trackName || 'Nothing Playing'}</h1>
                <h2 className="track-artist">{room.artistName || '...'}</h2>

                <div className="progress-container">
                    {/* Fake progress bar styling for aesthetics */}
                    <div className="progress-bar" style={{ width: room.status === 'playing' ? '100%' : '50%', transition: 'width 2s' }}></div>
                </div>
            </div>
            <div style={{ opacity: 0.5, marginTop: '2rem' }}>
                <span className={`badge ${room.status}`}>{room.status.toUpperCase()}</span>
                &nbsp; · &nbsp; Room {room.roomCode}
                {isHost && ' (HOST)'}
            </div>

            {/* Listener Sync UI */}
            {!isHost && room.type === 'spotify' && !spotifyListenerToken && (
                <button className="btn-spotify" onClick={handleSpotifyListenerLogin} style={{ marginTop: '1rem' }}>
                    Connect Spotify to Sync Playback
                </button>
            )}

            {!isHost && room.type === 'youtube' && !ytmdListenerToken && (
                <button className="btn-youtube" onClick={handleYTMDListenerLogin} disabled={listenerPending} style={{ marginTop: '1rem' }}>
                    {listenerPending ? 'Connecting...' : 'Connect YTMD to Sync Playback'}
                </button>
            )}

            {!isHost && ((room.type === 'spotify' && spotifyListenerToken) || (room.type === 'youtube' && ytmdListenerToken)) && (
                <div style={{ color: '#4ade80', marginTop: '1rem', fontWeight: 'bold' }}>
                    ✓ Synchronizing playback
                </div>
            )}
        </div>
    );
}
