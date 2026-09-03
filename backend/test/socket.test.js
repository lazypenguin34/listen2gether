'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { io: ioClient } = require('socket.io-client');
const { createServer, SOCKET_EVENTS } = require('../src/index');

const WAIT_TIMEOUT_MS = 3000;

/** Boots a fresh server instance on an ephemeral port. */
async function boot() {
    const { server, io, rooms, sweeper } = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { server, io, rooms, sweeper, baseUrl: `http://127.0.0.1:${port}` };
}

async function teardown(ctx, sockets = []) {
    for (const socket of sockets) {
        if (socket.connected) socket.disconnect();
    }
    clearInterval(ctx.sweeper);
    await new Promise((resolve) => ctx.io.close(resolve));
}

function connectClient(baseUrl) {
    return new Promise((resolve, reject) => {
        const socket = ioClient(baseUrl, {
            transports: ['websocket'],
            reconnection: false,
            forceNew: true,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('timed out connecting to server'));
        }, WAIT_TIMEOUT_MS);
        socket.once('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.once('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/** Waits for the next `event` on `socket` whose payload satisfies `predicate`. */
function waitFor(socket, event, predicate = () => true, timeoutMs = WAIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            reject(new Error(`timed out waiting for "${event}" matching predicate`));
        }, timeoutMs);

        function handler(payload) {
            if (!predicate(payload)) return;
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload);
        }

        socket.on(event, handler);
    });
}

async function createRoom(baseUrl) {
    const res = await fetch(`${baseUrl}/createRoom`, { method: 'POST' });
    return res.json();
}

test('joinRoom with an unknown code emits roomNotFound', async () => {
    const ctx = await boot();
    const client = await connectClient(ctx.baseUrl);
    try {
        const waiter = waitFor(client, SOCKET_EVENTS.roomNotFound);
        client.emit(SOCKET_EVENTS.joinRoom, '0000');
        const payload = await waiter;
        assert.equal(payload, '0000');
    } finally {
        await teardown(ctx, [client]);
    }
});

test('joinRoom with a valid code emits roomUpdated with the correct listenerCount', async () => {
    const ctx = await boot();
    const { roomCode } = await createRoom(ctx.baseUrl);
    const clientA = await connectClient(ctx.baseUrl);
    const clientB = await connectClient(ctx.baseUrl);
    try {
        const aJoined = waitFor(clientA, SOCKET_EVENTS.roomUpdated, (p) => p.listenerCount === 1);
        clientA.emit(SOCKET_EVENTS.joinRoom, roomCode);
        const aPayload = await aJoined;
        assert.equal(aPayload.roomCode, roomCode);
        assert.equal(aPayload.listenerCount, 1);

        // When B joins, A (already in the room) should see the listenerCount bump to 2.
        const aSeesTwo = waitFor(clientA, SOCKET_EVENTS.roomUpdated, (p) => p.listenerCount === 2);
        const bJoined = waitFor(clientB, SOCKET_EVENTS.roomUpdated, (p) => p.listenerCount === 2);
        clientB.emit(SOCKET_EVENTS.joinRoom, roomCode);
        await Promise.all([aSeesTwo, bJoined]);
    } finally {
        await teardown(ctx, [clientA, clientB]);
    }
});

test('a client that knows the room code but not the secret cannot update the room', async () => {
    const ctx = await boot();
    const { roomCode } = await createRoom(ctx.baseUrl);
    const client = await connectClient(ctx.baseUrl);
    try {
        const joined = waitFor(client, SOCKET_EVENTS.roomUpdated);
        client.emit(SOCKET_EVENTS.joinRoom, roomCode);
        await joined;

        const before = JSON.stringify(ctx.rooms.get(roomCode));

        const unauthorized = waitFor(client, SOCKET_EVENTS.unauthorized);
        client.emit(SOCKET_EVENTS.updateRoom, {
            roomCode,
            hostSecret: 'not-the-real-secret',
            trackName: 'Malicious Track',
            status: 'playing',
        });
        await unauthorized;

        // Assert against server-side truth, not against the absence of an event.
        const after = JSON.stringify(ctx.rooms.get(roomCode));
        assert.equal(after, before, 'room state must not change after an unauthorized update attempt');
    } finally {
        await teardown(ctx, [client]);
    }
});

test('a valid host update is broadcast to other clients in the room', async () => {
    const ctx = await boot();
    const { roomCode, hostSecret } = await createRoom(ctx.baseUrl);
    const listener = await connectClient(ctx.baseUrl);
    const host = await connectClient(ctx.baseUrl);
    try {
        const listenerJoined = waitFor(listener, SOCKET_EVENTS.roomUpdated);
        listener.emit(SOCKET_EVENTS.joinRoom, roomCode);
        await listenerJoined;

        const hostJoined = waitFor(host, SOCKET_EVENTS.roomUpdated);
        host.emit(SOCKET_EVENTS.joinRoom, { roomCode, hostSecret });
        await hostJoined;

        const listenerSeesUpdate = waitFor(
            listener,
            SOCKET_EVENTS.roomUpdated,
            (p) => p.trackName === 'Broadcast Track',
        );
        host.emit(SOCKET_EVENTS.updateRoom, {
            roomCode,
            hostSecret,
            trackName: 'Broadcast Track',
            status: 'playing',
            positionMs: 0,
        });
        const payload = await listenerSeesUpdate;
        assert.equal(payload.trackName, 'Broadcast Track');
        assert.equal(payload.status, 'playing');

        const room = ctx.rooms.get(roomCode);
        assert.equal(room.trackName, 'Broadcast Track');
    } finally {
        await teardown(ctx, [listener, host]);
    }
});

test('host disconnect is reflected as hostConnected: false for remaining clients', async () => {
    const ctx = await boot();
    const { roomCode, hostSecret } = await createRoom(ctx.baseUrl);
    const listener = await connectClient(ctx.baseUrl);
    const host = await connectClient(ctx.baseUrl);
    try {
        const listenerJoined = waitFor(listener, SOCKET_EVENTS.roomUpdated);
        listener.emit(SOCKET_EVENTS.joinRoom, roomCode);
        await listenerJoined;

        const hostJoined = waitFor(host, SOCKET_EVENTS.roomUpdated, (p) => p.hostConnected === true);
        host.emit(SOCKET_EVENTS.joinRoom, { roomCode, hostSecret });
        await hostJoined;

        const listenerSeesHostGone = waitFor(
            listener,
            SOCKET_EVENTS.roomUpdated,
            (p) => p.hostConnected === false,
        );
        host.disconnect();
        const payload = await listenerSeesHostGone;
        assert.equal(payload.hostConnected, false);
    } finally {
        await teardown(ctx, [listener, host]);
    }
});
