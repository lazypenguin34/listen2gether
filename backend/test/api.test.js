'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createServer } = require('../src/index');

/** Boots a fresh server instance on an ephemeral port. */
async function boot() {
    const { app, server, io, rooms, sweeper } = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { app, server, io, rooms, sweeper, baseUrl: `http://127.0.0.1:${port}` };
}

/** Tears down a booted instance so the test runner can exit cleanly. */
async function teardown(ctx) {
    clearInterval(ctx.sweeper);
    await new Promise((resolve) => ctx.io.close(resolve));
}

async function createRoom(baseUrl) {
    const res = await fetch(`${baseUrl}/createRoom`, { method: 'POST' });
    const body = await res.json();
    return { res, body };
}

// --- POST /createRoom ---

test('POST /createRoom returns a 4-char roomCode and a hex hostSecret', async () => {
    const ctx = await boot();
    try {
        const { res, body } = await createRoom(ctx.baseUrl);
        assert.equal(res.status, 201);
        assert.match(body.roomCode, /^[0-9]{4}$/);
        assert.match(body.hostSecret, /^[0-9a-f]{64}$/);
    } finally {
        await teardown(ctx);
    }
});

// --- GET /room/:code ---

test('GET /room/:code returns 200 with no host secret in the body', async () => {
    const ctx = await boot();
    try {
        const { body: created } = await createRoom(ctx.baseUrl);
        const res = await fetch(`${ctx.baseUrl}/room/${created.roomCode}`);
        const text = await res.text();
        assert.equal(res.status, 200);
        assert.ok(!text.includes(created.hostSecret), 'response leaked the host secret');
        assert.ok(!text.includes('hostSecret'));
        assert.ok(!text.includes('hostSocketId'));
    } finally {
        await teardown(ctx);
    }
});

test('GET /room/:code with an unknown code returns 404', async () => {
    const ctx = await boot();
    try {
        const res = await fetch(`${ctx.baseUrl}/room/9999`);
        assert.equal(res.status, 404);
    } finally {
        await teardown(ctx);
    }
});

// --- POST /updateRoom/:code ---

test('POST /updateRoom/:code with correct secret via Authorization header returns 204 and changes state', async () => {
    const ctx = await boot();
    try {
        const { body: created } = await createRoom(ctx.baseUrl);
        const res = await fetch(`${ctx.baseUrl}/updateRoom/${created.roomCode}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${created.hostSecret}`,
            },
            body: JSON.stringify({ trackName: 'Header Track', status: 'playing' }),
        });
        assert.equal(res.status, 204);

        const room = ctx.rooms.get(created.roomCode);
        assert.equal(room.trackName, 'Header Track');
        assert.equal(room.status, 'playing');
    } finally {
        await teardown(ctx);
    }
});

test('POST /updateRoom/:code with correct secret via JSON body returns 204 and changes state', async () => {
    const ctx = await boot();
    try {
        const { body: created } = await createRoom(ctx.baseUrl);
        const res = await fetch(`${ctx.baseUrl}/updateRoom/${created.roomCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostSecret: created.hostSecret, trackName: 'Body Track' }),
        });
        assert.equal(res.status, 204);

        const room = ctx.rooms.get(created.roomCode);
        assert.equal(room.trackName, 'Body Track');
    } finally {
        await teardown(ctx);
    }
});

test('POST /updateRoom/:code with a wrong secret returns 403 and leaves state unchanged', async () => {
    const ctx = await boot();
    try {
        const { body: created } = await createRoom(ctx.baseUrl);
        const before = JSON.stringify(ctx.rooms.get(created.roomCode));

        const res = await fetch(`${ctx.baseUrl}/updateRoom/${created.roomCode}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer totally-wrong-secret',
            },
            body: JSON.stringify({ trackName: 'Should Not Apply', status: 'playing' }),
        });

        assert.equal(res.status, 403);
        const after = JSON.stringify(ctx.rooms.get(created.roomCode));
        assert.equal(after, before, 'room state must be unchanged after a rejected update');
    } finally {
        await teardown(ctx);
    }
});

test('POST /updateRoom/:code with a malformed payload returns 400 with the reason', async () => {
    const ctx = await boot();
    try {
        const { body: created } = await createRoom(ctx.baseUrl);
        const res = await fetch(`${ctx.baseUrl}/updateRoom/${created.roomCode}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${created.hostSecret}`,
            },
            body: JSON.stringify({ status: 'buffering' }),
        });
        const body = await res.json();
        assert.equal(res.status, 400);
        assert.equal(body.error, 'status must be "playing" or "paused"');
    } finally {
        await teardown(ctx);
    }
});

test('POST /updateRoom/:code for an unknown room returns 404', async () => {
    const ctx = await boot();
    try {
        const res = await fetch(`${ctx.baseUrl}/updateRoom/9999`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostSecret: 'whatever', trackName: 'X' }),
        });
        assert.equal(res.status, 404);
    } finally {
        await teardown(ctx);
    }
});

// --- GET /getRooms ---

test('GET /getRooms responds 503 when ADMIN_TOKEN is unset', async () => {
    const previous = process.env.ADMIN_TOKEN;
    delete process.env.ADMIN_TOKEN;
    const ctx = await boot();
    try {
        const res = await fetch(`${ctx.baseUrl}/getRooms`);
        assert.equal(res.status, 503);
    } finally {
        await teardown(ctx);
        if (previous !== undefined) process.env.ADMIN_TOKEN = previous;
    }
});

test('GET /getRooms responds 401 with a wrong token and 200 with the right one', async () => {
    const previous = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = 'the-real-admin-token';
    const ctx = await boot();
    try {
        const badRes = await fetch(`${ctx.baseUrl}/getRooms`, {
            headers: { Authorization: 'Bearer wrong-token' },
        });
        assert.equal(badRes.status, 401);

        const goodRes = await fetch(`${ctx.baseUrl}/getRooms`, {
            headers: { Authorization: 'Bearer the-real-admin-token' },
        });
        assert.equal(goodRes.status, 200);
        const body = await goodRes.json();
        assert.ok(Array.isArray(body.rooms));
    } finally {
        await teardown(ctx);
        if (previous === undefined) delete process.env.ADMIN_TOKEN;
        else process.env.ADMIN_TOKEN = previous;
    }
});

// --- GET /health ---

test('GET /health returns 200', async () => {
    const ctx = await boot();
    try {
        const res = await fetch(`${ctx.baseUrl}/health`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
    } finally {
        await teardown(ctx);
    }
});
