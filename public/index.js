// Listen for when the user has logged in
window.addEventListener('hashchange', (event) => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);

    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const error = params.get('error');

    if (access_token && refresh_token) {
        console.log(`Successfully got access: ${access_token} and refresh tokens: ${refresh_token}`);

        document.getElementById('login').hidden = true;
        document.getElementById('nowPlaying').removeAttribute('hidden');
    }

    if (error) {
        console.error(`Failed to login: ${error}`);
    }
});

async function authenticateYTMD() {
    // Get code from companion server to exchange for token
    let res = await fetch('http://localhost:9683/api/v1/auth/requestcode', {
        method: 'POST',
        body: JSON.stringify({
            'appId': 'listen2gether',
            'appName': 'listen2gether',
            'appVersion': '1.0.0',
        })
    });
    if (!res.ok) throw new Error('Failed to request code for YTMD');

    const data = await res.json();
    const code = data.code;

    // Exchange code for token
    res = await fetch('http://localhost:9683/api/v1/auth/request', {
        method: 'POST',
        body: JSON.stringify({
            'appId': 'listen2gether',
            'code': code,
        })
    });
    if (!res.ok) throw new Error('Failed to request token for YTMD');

    const token = data.token;

    // Establish Socket.IO connection
    const socket = io('http://127.0.0.1:9683/api/v1/realtime', {
        transports: ['websocket'],
        auth: {
            token: token,
        },
    });

    socket.on('connect', () => {
        console.log('Connected to the Socket.IO server');
    });

    socket.on("connect_error", (error) => {
        console.error("Socket.IO connection error:", error);
    });

    socket.on("state-update", async (state) => {
        const res = await fetch('http://0.0.0.0:8888/updateYTRoom', {
            method: 'POST',
            body: JSON.stringify({
                status: state.player.trackState === 1 ? 'playing' : 'paused',
                positionMs: state.player.videoProgress * 1000, // FIXME: Check if this is ms
                adPlaying: state.player.adPlaying,
                trackName: state.video.title,
                albumArt: state.video.thumbnails[0].url,
            })
        });
        if (!res.ok) throw new Error('Failed to update room');
    });
}
