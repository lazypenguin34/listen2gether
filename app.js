const express = require('express');
const path = require('path')
const crypto = require('crypto')
const cors = require('cors');
const {URLSearchParams} = require('url');
const cookieParser = require('cookie-parser');

const app = express();

// TODO: use environment variables
const client_id = 'ce4879073a2b4ec0af0a8cbb736648eb';
const client_secret = 'ef0269b6eed9454fb4818fb21720aa3e'

const port = 8888;
const redirect_uri = `http://localhost:${port}/callback`;

function SpotifyRoom(roomCode, hostAccessToken, hostRefreshToken, trackName, albumArt, status, positionMs) {
    this.roomCode = roomCode;
    this.hostAccessToken = hostAccessToken;
    this.hostRefreshToken = hostRefreshToken;
    this.trackName = trackName;
    this.positionMs = positionMs;
    this.albumArt = albumArt;
    this.status = status;
}

// TODO: Make a YouTube room struct

const sdb = new Map() // spotify database
const ydb = new Map() // youtube database

const MAX_ROOM_CODE = 9999;
const ROOM_UPDATE_INTERVAL_MS = 2000;

function generateRoomCode() {
    if (sdb.size + ydb.size >= MAX_ROOM_CODE) {
        throw new Error('Exceeded the maximum allowed number of rooms');
    }

    let roomCode;
    do {
        roomCode = crypto.randomInt(1, MAX_ROOM_CODE + 1); // +1 because the upper bound is exclusive
    } while (sdb.has(roomCode) || ydb.has(roomCode));

    return roomCode;
}

async function updateSpotifyRoom(roomCode) {
    const hostAccessToken = sdb.get(roomCode).hostAccessToken;

    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
        headers: {
            Authorization: `Bearer ${hostAccessToken}`,
        },
    });
    if (!res.ok) throw new Error(res.statusText);

    const data = await res.json();
    const room = sdb.get(roomCode);

    // If there's an ad or the type is unknown, don't update anything
    if (data.currently_playing_type === 'ad' || data.currently_playing_type === 'unknown') return;

    // If paused, don't update any other data since it will either be null or the same
    if (!data.is_playing) {
        room.status = 'paused';
        return;
    }

    // If the track name is the same, just update the position since everything else will be the same
    if (room.trackName === data.item.name) {
        room.positionMs = data.progress_ms;
        return;
    }

    room.trackName = data.item.name;
    room.positionMs = data.progress_ms;
    room.status = 'playing';
    room.albumArt = data.item.album.images[0].url;
    console.log('Updated room: ', roomCode);
}

// Updates rooms concurrently, but waits for all rooms to be updated before finishing the function
async function updateRooms() {
    const spotifyRoomCodes = Array.from(sdb.keys());

    try {
        const updatePromises = spotifyRoomCodes.map((roomCode) => {
            return updateSpotifyRoom(roomCode);  // Returns a promise for each room update
        });

        await Promise.all(updatePromises);
    } catch (error) {
        console.error('Error updating rooms:', error);
    }
}

app.use(express.static(path.join(__dirname, 'public')))
    .use(cors())
    .use(cookieParser());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function generateRandomString(length) {
    return crypto
        .randomBytes(length)
        .toString('hex')
        .slice(0, length);
}

const stateKey = 'spotify_auth_state';
app.get('/spotifyLogin', (req, res) => {
    const state = generateRandomString(16);
    res.cookie(stateKey, state);

    const scope = 'user-read-private user-read-email user-read-currently-playing';
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: client_id,
        scope: scope,
        redirect_uri: redirect_uri,
        state: state
    })

    res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

app.get('/callback', async function (req, res) {
    // Your application requests refresh and access tokens
    // after checking the state parameter

    const code = req.query.code || null;
    const state = req.query.state || null;
    const storedState = req.cookies ? req.cookies[stateKey] : null;

    if (state === null || state !== storedState) {
        res.redirect(
            '/#' +
            new URLSearchParams({
                error: 'state_mismatch',
            }).toString()
        );
    } else {
        res.clearCookie(stateKey);

        const authParams = new URLSearchParams({
            code: code,
            redirect_uri: redirect_uri,
            grant_type: 'authorization_code',
        });

        const authHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
                'Basic ' +
                Buffer.from(`${client_id}:${client_secret}`).toString('base64'),
        };

        try {
            // Exchange authorization code for tokens
            const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                body: authParams.toString(),
                headers: authHeaders,
            });

            if (!tokenResponse.ok) {
                throw new Error('Failed to exchange authorization code for tokens');
            }

            const tokenData = await tokenResponse.json();
            const {access_token, refresh_token} = tokenData;

            // Use the access token to access the Spotify Web API
            const userProfileResponse = await fetch('https://api.spotify.com/v1/me', {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                },
            });

            if (!userProfileResponse.ok) {
                throw new Error('Failed to fetch user profile');
            }

            const userProfile = await userProfileResponse.json();
            console.log(userProfile);

            // Try to create room
            const roomCode = generateRoomCode();
            sdb.set(roomCode, new SpotifyRoom(roomCode, access_token, refresh_token, null, null, null, null));
            await updateSpotifyRoom(roomCode)

            // Redirect with tokens
            res.redirect(
                '/#' +
                new URLSearchParams({
                    access_token: access_token,
                    refresh_token: refresh_token,
                }).toString()
            );
        } catch (error) {
            console.error(error);

            // Redirect with error
            res.redirect(
                '/#' +
                new URLSearchParams({
                    error: error,
                }).toString()
            );
        }
    }
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// TODO: get youtube rooms
app.get('/getRooms', (req, res) => {
    res.json(Array.from(sdb.values()));
});

setInterval(updateRooms, ROOM_UPDATE_INTERVAL_MS);

app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running at http://0.0.0.0:${port}`);
});

