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
