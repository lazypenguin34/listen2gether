'use strict';

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const {
    Room,
    toPublicRoom,
    parseRoomUpdate,
    applyRoomUpdate,
    generateHostSecret,
    generateRoomCode,
    secretMatches,
} = require('./room');
const { startSweeper } = require('./rooms-store');
const { createRateLimiter } = require('./rate-limiter');

// Mirrors frontend/src/lib/config.js SOCKET_EVENTS. Keep the two in step.
const SOCKET_EVENTS = {
    // client -> server
    joinRoom: 'joinRoom',
    updateRoom: 'updateRoom',
    // server -> client
    roomUpdated: 'roomUpdated',
    roomNotFound: 'roomNotFound',
    unauthorized: 'unauthorized',
    updateRejected: 'updateRejected',
};

/** Pulls a bearer token out of the Authorization header, if present. */
function bearerToken(req) {
    const header = req.get('authorization');
    if (!header || !header.startsWith('Bearer ')) return null;
    return header.slice('Bearer '.length).trim();
}

/** A host secret may arrive via the Authorization header or the JSON body. */
function extractHostSecret(req) {
    const fromHeader = bearerToken(req);
    if (fromHeader) return fromHeader;
    if (req.body && typeof req.body.hostSecret === 'string') return req.body.hostSecret;
    return null;
}

function listenerCountFor(io, roomCode) {
    return io.sockets.adapter.rooms.get(roomCode)?.size ?? 0;
}

function createServer() {
    const isProd = process.env.NODE_ENV === 'production' || !!process.env.WEBSITE_HOSTNAME;
    const FRONTEND_URL = process.env.FRONTEND_URL || (isProd ? 'https://ashy-coast-0a6ab390f.1.azurestaticapps.net' : 'http://localhost:5173');

    const ALLOWED_ORIGINS = [
        FRONTEND_URL,
        'http://localhost:5173',
        'https://ashy-coast-0a6ab390f.1.azurestaticapps.net'
    ].filter(Boolean);

    const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
    if (!ADMIN_TOKEN) {
        console.warn('WARNING: ADMIN_TOKEN is not set. GET /getRooms will respond 503 until it is configured.');
    }

    const app = express();
    const server = http.createServer(app);
    const rooms = new Map();

    app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
    app.use(express.json());

    const io = new Server(server, {
        cors: {
            origin: ALLOWED_ORIGINS,
            credentials: true,
        },
    });

    // --- REST ---

    app.get('/health', (req, res) => {
        res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() });
    });

    app.post('/createRoom', (req, res) => {
        let roomCode;
        try {
            roomCode = generateRoomCode(rooms);
        } catch (e) {
            return res.status(503).json({ error: e.message });
        }

        const hostSecret = generateHostSecret();
        rooms.set(roomCode, new Room(roomCode, hostSecret));
        res.status(201).json({ roomCode, hostSecret });
    });

    app.get('/room/:roomCode', (req, res) => {
        const room = rooms.get(req.params.roomCode);
        if (!room) return res.status(404).json({ error: 'Room not found' });
        res.json(toPublicRoom(room, listenerCountFor(io, room.roomCode)));
    });

    app.post('/updateRoom/:roomCode', (req, res) => {
        const room = rooms.get(req.params.roomCode);
        if (!room) return res.status(404).json({ error: 'Room not found' });

        if (!secretMatches(room.hostSecret, extractHostSecret(req))) {
            return res.status(403).json({ error: 'Invalid host secret' });
        }

        const parsed = parseRoomUpdate(req.body);
        if (!parsed.ok) return res.status(400).json({ error: parsed.error });

        applyRoomUpdate(room, parsed.value);

        const publicRoom = toPublicRoom(room, listenerCountFor(io, room.roomCode));
        io.to(room.roomCode).emit(SOCKET_EVENTS.roomUpdated, publicRoom);

        res.status(204).send();
    });

    app.get('/getRooms', (req, res) => {
        if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin API not configured' });
        if (!secretMatches(ADMIN_TOKEN, bearerToken(req))) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        res.json({
            rooms: Array.from(rooms.values()).map((room) => toPublicRoom(room, listenerCountFor(io, room.roomCode))),
        });
    });

    // --- Socket.IO ---

    const rateLimiter = createRateLimiter();

    io.on('connection', (socket) => {
        socket.on(SOCKET_EVENTS.joinRoom, (payload) => {
            const roomCode = typeof payload === 'string' ? payload : payload?.roomCode;
            const hostSecret = (payload && typeof payload === 'object') ? payload.hostSecret : undefined;

            const room = rooms.get(roomCode);
            if (!room) {
                socket.emit(SOCKET_EVENTS.roomNotFound, roomCode);
                return;
            }

            socket.join(roomCode);
            room.lastSeenAt = Date.now();

            if (hostSecret && secretMatches(room.hostSecret, hostSecret)) {
                room.hostSocketId = socket.id;
            }

            const publicRoom = toPublicRoom(room, listenerCountFor(io, roomCode));
            // The joiner gets full state immediately...
            socket.emit(SOCKET_EVENTS.roomUpdated, publicRoom);
            // ...everyone else just needs the refreshed listenerCount (carried on the same shape).
            socket.to(roomCode).emit(SOCKET_EVENTS.roomUpdated, publicRoom);
        });

        socket.on(SOCKET_EVENTS.updateRoom, (payload) => {
            if (!rateLimiter.allow(socket.id)) return;

            const { roomCode, hostSecret, ...fields } = payload || {};
            const room = rooms.get(roomCode);
            if (!room) return;

            if (!secretMatches(room.hostSecret, hostSecret)) {
                socket.emit(SOCKET_EVENTS.unauthorized);
                return;
            }

            const parsed = parseRoomUpdate(fields);
            if (!parsed.ok) {
                socket.emit(SOCKET_EVENTS.updateRejected, { error: parsed.error });
                return;
            }

            applyRoomUpdate(room, parsed.value);
            io.to(roomCode).emit(SOCKET_EVENTS.roomUpdated, toPublicRoom(room, listenerCountFor(io, roomCode)));
        });

        socket.on('disconnecting', () => {
            for (const roomCode of socket.rooms) {
                if (roomCode === socket.id) continue; // socket's own private room
                const room = rooms.get(roomCode);
                if (!room) continue;

                if (room.hostSocketId === socket.id) {
                    room.hostSocketId = null;
                }

                // `disconnecting` fires while this socket is still counted in the room.
                const count = Math.max(0, listenerCountFor(io, roomCode) - 1);
                io.to(roomCode).emit(SOCKET_EVENTS.roomUpdated, toPublicRoom(room, count));
            }
        });

        socket.on('disconnect', () => {
            rateLimiter.remove(socket.id);
        });
    });

    const sweeper = startSweeper(rooms);

    return { app, server, io, rooms, sweeper };
}

if (require.main === module) {
    const port = process.env.PORT || 8888;
    const { server } = createServer();
    server.listen(port, '0.0.0.0', () => {
        console.log(`Backend server is running on port ${port}`);
    });
}

module.exports = { createServer, SOCKET_EVENTS };
