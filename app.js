const express = require('express');
const path = require('path')
const crypto = require('crypto')
const cors = require('cors');
const { URLSearchParams } = require('url');
const cookieParser = require('cookie-parser');

const app = express();

const client_id = 'ce4879073a2b4ec0af0a8cbb736648eb';
const client_secret = 'ef0269b6eed9454fb4818fb21720aa3e'

const port = 8888;
const redirect_uri = `http://localhost:${port}/callback`;

const db = new Map();
db.set(1, { roomCode: 1, hostPlatform: 'test', currentPlaying: 'the test song', status: 'paused' });

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

    const scope = 'user-read-private user-read-email streaming';
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
      const { access_token, refresh_token } = tokenData;

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

app.get('/getRooms', (req, res) => {
    res.json(Object.fromEntries(db));
});

app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
});

