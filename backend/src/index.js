const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 8888;
const isProd = process.env.NODE_ENV === 'production' || !!process.env.WEBSITE_HOSTNAME;
const FRONTEND_URL = process.env.FRONTEND_URL || (isProd ? 'https://ashy-coast-0a6ab390f.1.azurestaticapps.net' : 'http://localhost:5173');
const BACKEND_URL = process.env.BACKEND_URL || (isProd ? 'https://listen2gether-backend.azurewebsites.net' : `http://localhost:${port}`);
const redirect_uri = `${BACKEND_URL}/callback`;

const client_id = process.env.SPOTIFY_CLIENT_ID || 'ce4879073a2b4ec0af0a8cbb736648eb';
const client_secret = process.env.SPOTIFY_CLIENT_SECRET || 'ef0269b6eed9454fb4818fb21720aa3e';

// Keep State in-memory (Maps)
const sdb = new Map();
const ydb = new Map();
const MAX_ROOM_CODE = 9999;
const ROOM_UPDATE_INTERVAL_MS = 2000;

const ALLOWED_ORIGINS = [
    FRONTEND_URL,
    'http://localhost:5173',
    'https://ashy-coast-0a6ab390f.1.azurestaticapps.net'
].filter(Boolean);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- Models ---
class SpotifyRoom {
    constructor(roomCode, hostAccessToken, hostRefreshToken) {
        this.roomCode = roomCode;
        this.hostAccessToken = hostAccessToken;
        this.hostRefreshToken = hostRefreshToken;
        this.trackName = null;
        this.artistName = null;
        this.trackUri = null;
        this.positionMs = 0;
        this.albumArt = null;
        this.status = 'paused';
        this.type = 'spotify';
    }
}

class YoutubeRoom {
    constructor(roomCode) {
        this.roomCode = roomCode;
        this.trackName = null;
        this.artistName = null;
        this.videoId = null;
        this.albumArt = null;
        this.status = 'paused';
        this.positionMs = 0;
        this.type = 'youtube';
    }
}

// --- Utilities ---
function generateRoomCode() {
    if (sdb.size + ydb.size >= MAX_ROOM_CODE) {
        throw new Error('No empty rooms available.');
    }
    let roomCode;
    do {
        roomCode = crypto.randomInt(1, MAX_ROOM_CODE + 1).toString().padStart(4, '0');
    } while (sdb.has(roomCode) || ydb.has(roomCode));
    return roomCode;
}

function generateRandomString(length) {
    return crypto.randomBytes(length).toString('hex').slice(0, length);
}

// --- Spotify Polling Logic ---
async function updateSpotifyRoom(roomCode) {
    const room = sdb.get(roomCode);
    if (!room) return;

    try {
        const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { Authorization: `Bearer ${room.hostAccessToken}` },
        });

        if (!res.ok) {
            // Handle token expiry ideally, but keeping it simple for now
            return;
        }

        // 204 No Content means nothing is playing
        if (res.status === 204) {
            room.status = 'paused';
            return;
        }

        const data = await res.json();

        // Check if an ad or unknown
        if (data.currently_playing_type === 'ad' || data.currently_playing_type === 'unknown') {
            return; // ignore update during ads
        }

        if (!data.is_playing) {
            room.status = 'paused';
            return;
        }

        // Updating live details
        room.positionMs = data.progress_ms;
        if (room.trackName !== data.item.name) {
            room.trackName = data.item.name;
            room.artistName = data.item.artists.map(a => a.name).join(', ');
            room.trackUri = data.item.uri;
            room.albumArt = data.item.album.images[0]?.url || null;
            room.status = 'playing';
            console.log(`[Spotify] Updated room ${roomCode} view to: ${room.trackName}`);
        }
    } catch (e) {
        console.error(`Error updating Spotify Room ${roomCode}:`, e);
    }
}

async function updateSpotifyRooms() {
    const promises = Array.from(sdb.keys()).map(roomCode => updateSpotifyRoom(roomCode));
    await Promise.allSettled(promises);
}

setInterval(updateSpotifyRooms, ROOM_UPDATE_INTERVAL_MS);

// --- Endpoints ---

// 1. Spotify Auth
const stateKey = 'spotify_auth_state';
const joinRoomKey = 'spotify_join_room';

app.get('/spotifyLogin', (req, res) => {
    const state = generateRandomString(16);
    res.cookie(stateKey, state);

    if (req.query.joinRoom) {
        res.cookie(joinRoomKey, req.query.joinRoom);
    } else {
        res.clearCookie(joinRoomKey);
    }

    const scope = 'user-read-private user-read-email user-read-currently-playing user-modify-playback-state';
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
    });

    res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        return res.redirect(`${FRONTEND_URL}/?error=state_mismatch`);
    }

    res.clearCookie(stateKey);

    const authParams = new URLSearchParams({
        code: code,
        redirect_uri: redirect_uri,
        grant_type: 'authorization_code',
    });

    const authHeaders = {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
    };

    try {
        const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            body: authParams.toString(),
            headers: authHeaders,
        });

        if (!tokenResponse.ok) throw new Error('Failed to exchange auth code');

        const tokenData = await tokenResponse.json();
        
        const joinRoom = req.cookies ? req.cookies[joinRoomKey] : null;
        res.clearCookie(joinRoomKey);

        if (joinRoom) {
            // This is a listener logging in, redirect back to their room with the token
            return res.redirect(`${FRONTEND_URL}/room/${joinRoom}?listenerToken=${tokenData.access_token}`);
        }

        const roomCode = generateRoomCode();
        
        sdb.set(roomCode, new SpotifyRoom(roomCode, tokenData.access_token, tokenData.refresh_token));
        await updateSpotifyRoom(roomCode);

        // Redirect host to the room
        res.redirect(`${FRONTEND_URL}/room/${roomCode}?host=true`);
    } catch (err) {
        console.error(err);
        res.redirect(`${FRONTEND_URL}/?error=auth_failed`);
    }
});

// 2. Room Lookups
app.get('/room/:roomCode', (req, res) => {
    const { roomCode } = req.params;
    let room = sdb.get(roomCode) || ydb.get(roomCode);
    
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    // Strip out sensitive host tokens before sending to client
    const safeRoomData = {
        roomCode: room.roomCode,
        trackName: room.trackName,
        artistName: room.artistName,
        trackUri: room.trackUri,
        videoId: room.videoId,
        albumArt: room.albumArt,
        status: room.status,
        positionMs: room.positionMs,
        type: room.type
    };

    res.json(safeRoomData);
});

// 3. YouTube Music (YTMD) API Integration
app.post('/createYTRoom', (req, res) => {
    try {
        const roomCode = generateRoomCode();
        ydb.set(roomCode, new YoutubeRoom(roomCode));
        res.status(201).json({ roomCode });
    } catch (e) {
        res.status(503).json({ error: e.message });
    }
});

app.post('/updateYTRoom/:roomCode', (req, res) => {
    const { roomCode } = req.params;
    const room = ydb.get(roomCode);

    if (!room) {
        return res.status(404).json({ error: 'Youtube Room not found' });
    }

    const { status, positionMs, trackName, artistName, albumArt, videoId } = req.body;
    
    // Process the state coming from the YTMD client
    if (status) room.status = status;
    if (typeof positionMs !== 'undefined') room.positionMs = positionMs;
    if (trackName) room.trackName = trackName;
    if (artistName) room.artistName = artistName;
    if (albumArt) room.albumArt = albumArt;
    if (videoId) room.videoId = videoId;

    res.status(204).send();
});

// 4. Admin API
app.get('/getRooms', (req, res) => {
    res.json({
        spotify: Array.from(sdb.values()).map(r => ({ ...r, hostAccessToken: undefined, hostRefreshToken: undefined })),
        yt: Array.from(ydb.values()),
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server is running on port ${port}`);
});
