async function getRooms() {
    const res = await fetch('http://localhost:8888/getRooms');
    if (!res.ok) throw new Error('Failed to fetch rooms');
    const data = await res.json();

    const tableBody = document.getElementById('roomsTable');

    // Clear existing rows
    tableBody.innerHTML = '';

    // Populate table with new rows
    data.forEach((room) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${room.roomCode}</td>
            <td>${room.hostPlatform}</td>
            <td>${room.currentlyPlaying}</td>
            <td>${room.status}</td>
            `;
        tableBody.appendChild(tr);
    });
}

window.addEventListener('DOMContentLoaded', getRooms);
