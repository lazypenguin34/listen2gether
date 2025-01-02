async function updateTable() {
    const res = await fetch('http://localhost:8888/getRooms');
    if (!res.ok) throw new Error('Failed to fetch rooms');
    const data = await res.json();
    console.log(data);

    const spotifyTableBody = document.getElementById('spotifyRoomsTable');
    const ytTableBody = document.getElementById('ytRoomsTable');

    // Clear existing rows
    spotifyTableBody.innerHTML = '';
    ytTableBody.innerHTML = '';

    // Populate tables with new rows
    data.spotify.forEach((room) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${room.roomCode}</td>
            <td>${room.hostAccessToken}</td>
            <td>${room.hostRefreshToken}</td>
            <td>${room.trackName}</td>
            <td>${room.positionMs}</td>
            <td>${room.albumArt}</td>
            <td>${room.status}</td>
            `;
        spotifyTableBody.appendChild(tr);
    });

    data.yt.forEach((room) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${room.roomCode}</td>
            <td>${room.trackName}</td>
            <td>${room.positionMs}</td>
            <td>${room.albumArt}</td>
            <td>${room.status}</td>
            `;
        spotifyTableBody.appendChild(tr);
    });
}

setInterval(updateTable, 2000);
