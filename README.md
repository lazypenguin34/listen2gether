# listen2gether

listen2gether is a synchronized listening-party app for YouTube Music. One person hosts from their YouTube Music Desktop app; everyone else joins with a 4-digit room code and watches (and, if they also run the desktop app, hears) the same track at the same position in near real time.

The backend is a thin Socket.IO/Express relay: it holds room state in memory, timestamps every update, and rebroadcasts it. All the real work — reading local playback, issuing play/pause/seek commands — happens in the browser, talking to the YouTube Music Desktop companion API on `localhost`.

## Prerequisites — read this first

This is the part most likely to waste your time if you skip it.

- **Hosting requires the [YouTube Music Desktop app (YTMD)](https://github.com/ytmdesktop/ytmdesktop)**, installed and running, with its **Companion Server enabled** in its settings. There is no server-side playback source (no Spotify, no YouTube API polling) — the host's own desktop app *is* the source of truth for the room.
- The first time you host or connect as a listener, YTMD will show a **pairing request that you must approve inside the app itself**. If you click "Host a room" or "Connect YTMD" and nothing happens, check for that prompt.
- **A listener who does not run YTMD can still join a room and see what's playing** (track name, artist, art, progress bar) — the room state is pushed to everyone over the socket. But without the desktop app, their own player has nothing to control, so they cannot actually hear synced audio. They'll be offered a "Connect YTMD to sync playback" button that runs the same pairing flow.
- Everything talks to YTMD's companion server on `http://localhost:9863` (configurable). This only works from a browser running on the *same machine* as YTMD — there's no remote-control path.

## Local setup

```bash
# from the repo root
npm install
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

Copy the example env files and adjust as needed:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

See [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example) for what each variable does — also summarized in [Configuration](#configuration) below.

Start both apps from the repo root:

```bash
npm run dev
```

This runs `concurrently` over the backend (`node --watch`) and the frontend (`vite`):

- Backend: `http://localhost:8888`
- Frontend: `http://localhost:5173`

Open the frontend, click "Host a room" (this triggers the YTMD pairing prompt described above), or join an existing room with its code.

## Architecture: how sync works

1. **Host polling.** While hosting, the host's browser polls its local YTMD companion server every `HOST_POLL_INTERVAL_MS` (5.5s) for the current track, position, and play/pause state.
2. **Diffing and pushing.** The host only emits an `updateRoom` socket event when something a listener would care about changed: track, play/pause state, a real seek (position jumped by more than `SEEK_TOLERANCE_MS`), or a heartbeat every `HOST_HEARTBEAT_MS` (15s) so late joiners and clock drift self-correct even when nothing else changed.
3. **Server timestamping.** The backend never trusts a client's clock. Each accepted update is stamped with the server's own `Date.now()` as `updatedAt`, and the position stored is exactly what the host reported at that instant — see `effectivePositionMs` in `backend/src/room.js`.
4. **Broadcast with a clock anchor.** Every push to the room (`roomUpdated`) carries `updatedAt` (when the state was true) and `serverNow` (the server's clock at emit time). Each client diffs those two to compute its own clock offset from the server, without needing synchronized wall clocks.
5. **Listener interpolation.** Listeners don't wait for the next update to see progress move — they interpolate the current position client-side from `positionMs`, `updatedAt`, and their derived clock offset (mirrored in `frontend/src/lib/playback.js`, kept in exact sync with the backend's version by design).
6. **Listener correction.** If a listener also has YTMD connected, a faster control loop (every `LISTENER_CONTROL_INTERVAL_MS` = 1.5s) compares local playback to the interpolated host position and only issues a corrective `seekTo` once drift exceeds `DRIFT_TOLERANCE_MS` (2s) — small timing jitter is left alone so the player isn't constantly seeking.

All of this state is **in-memory only**. There is no database. A backend restart or redeploy silently drops every room; hosts and listeners just see "Room not found" and have to start over.

## API reference

### REST

| Method | Path | Auth | Response |
|---|---|---|---|
| `GET` | `/health` | none | `200 { ok: true, rooms: <count>, uptime: <seconds> }` |
| `POST` | `/createRoom` | none | `201 { roomCode, hostSecret }`, or `503 { error }` if all 10,000 room codes are in use |
| `GET` | `/room/:roomCode` | none | `200 <PublicRoom>`, or `404 { error: "Room not found" }` |
| `POST` | `/updateRoom/:roomCode` | host secret (see below) | `204` on success; `404` room not found; `403 { error }` bad/missing secret; `400 { error }` invalid payload |
| `GET` | `/getRooms` | `Authorization: Bearer $ADMIN_TOKEN` | `200 { rooms: [<PublicRoom>, ...] }`; `401 { error }` bad token; `503 { error }` if `ADMIN_TOKEN` isn't configured on the server |

The host secret for `/updateRoom/:roomCode` can be supplied either as `Authorization: Bearer <hostSecret>` or as `hostSecret` in the JSON body.

**`PublicRoom` shape** (from `backend/src/room.js`, `toPublicRoom`):

```json
{
  "roomCode": "0421",
  "trackName": "string | null",
  "artistName": "string | null",
  "videoId": "string | null",
  "albumArt": "https URL | null",
  "status": "playing | paused",
  "positionMs": 0,
  "durationMs": 0,
  "updatedAt": 0,
  "hostConnected": true,
  "listenerCount": 0,
  "serverNow": 0
}
```

`hostSecret` and internal bookkeeping (socket id, `createdAt`, `lastSeenAt`) never leave the server.

### Socket.IO events

| Direction | Event | Payload |
|---|---|---|
| client → server | `joinRoom` | `roomCode` (string) or `{ roomCode, hostSecret? }`. Passing the correct `hostSecret` marks this socket as the room's host. |
| client → server | `updateRoom` | `{ roomCode, hostSecret, ...fields }` — any subset of `status`, `positionMs`, `durationMs`, `trackName`, `artistName`, `albumArt`, `videoId`. Rate-limited per socket (token bucket: ~10/sec sustained, burst 20). |
| server → client | `roomUpdated` | `<PublicRoom>` — sent to the joiner immediately on `joinRoom`, and to the whole room on every accepted `updateRoom` (REST or socket) and on join/leave (for `listenerCount`). |
| server → client | `roomNotFound` | the requested `roomCode`, when `joinRoom` targets a room that doesn't exist. |
| server → client | `unauthorized` | no payload — emitted to the caller when `updateRoom`'s `hostSecret` doesn't match the room's. |
| server → client | `updateRejected` | `{ error }` — emitted to the caller when `updateRoom`'s fields fail validation (`parseRoomUpdate`). |

## Configuration

### Backend (`backend/.env`, see `backend/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8888` | Port the Express/Socket.IO server listens on. |
| `NODE_ENV` | `development` | Set to `production` in deployment; also treated as production when `WEBSITE_HOSTNAME` (Azure App Service) is set. |
| `FRONTEND_URL` | `http://localhost:5173` in dev, the deployed Static Web Apps URL in production | Origin allowed to make cross-origin requests to this backend. |
| `ADMIN_TOKEN` | *(none — required for `/getRooms`)* | Bearer token for the admin API. Generate with `openssl rand -hex 32`. Leaving it unset doesn't crash the server — it just makes `/getRooms` respond `503`. |

### Frontend (`frontend/.env`, see `frontend/.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_BACKEND_URL` | `http://localhost:8888` | URL of the backend Express/Socket.IO server. |
| `VITE_YTMD_URL` | `http://localhost:9863` | URL of the local YouTube Music Desktop companion server. Its port is user-configurable inside YTMD. |

Everything else that's tunable (poll intervals, drift/seek tolerances, storage keys, the YTMD app identity) is a hardcoded constant in `frontend/src/lib/config.js` rather than an env var — see that file if you need to change timing behavior.

## Scripts

From the repo root:

```bash
npm run dev      # runs backend (node --watch) and frontend (vite) together
npm run server   # backend only
npm run client   # frontend only
```

Lint, test, build, and format are defined per-package. Note the **lint script is unusual**: it's defined in `frontend/package.json` but `cd`s up to the repo root and invokes ESLint straight out of `frontend/node_modules`, so it can lint `backend/src` and `frontend/src` in a single pass against the shared root `eslint.config.mjs`:

```bash
cd frontend
npm run lint     # cd .. && node frontend/node_modules/.bin/eslint --config eslint.config.mjs backend/src frontend/src
```

There is no root-level `lint`/`test`/`build` script — run these from inside each package:

```bash
# frontend
cd frontend
npm run test     # vitest run
npm run build    # vite build
npm run format   # prettier --write over both backend/src and frontend/src
npm run format:check

# backend
cd backend
npm test         # node --test test/
```

Two things worth knowing before you rely on these:

- As of this writing, `frontend/src` has no `*.test.*` files yet, so `npm run test` in `frontend/` currently exits with "No test files found" — that's expected to change as tests are added, not a sign anything is misconfigured.
- The backend's `node --test test/` invocation is sensitive to Node version: on the Node installed in this environment (v25.9.0) it fails with `MODULE_NOT_FOUND` because the CLI doesn't resolve the bare directory argument, even though the tests themselves are fine (`node --test` with no path argument runs and passes all 48 of them). CI pins `node-version: '24.x'`, which may or may not hit the same issue. If `npm test` in `backend/` fails with `MODULE_NOT_FOUND` for you, try `node --test` with no arguments as a workaround.

## Deployment

Two GitHub Actions workflows deploy to Azure on every push to `main`:

- **`.github/workflows/main_listen2gether-backend.yml`** builds `backend/` and deploys it to the Azure App Service `listen2gether-backend` (Production slot).
- **`.github/workflows/azure-static-web-apps-ashy-coast-0a6ab390f.yml`** builds `frontend/` (`app_location: ./frontend`, `output_location: dist`) and deploys it to Azure Static Web Apps, including PR preview environments.

A separate **`.github/workflows/ci.yml`** runs on pull requests and pushes to `main`: lint + test + build for the frontend, test for the backend. It does not deploy anything.

**Manual step required on the Azure App Service (invisible from this repo):**

- Set `ADMIN_TOKEN` in the App Service's Application Settings (Configuration blade) — it is not read from any file checked into the repo, and without it the deployed `/getRooms` endpoint will 503 for everyone, admin included.
- Delete the old `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` application settings if they're still there from before this rewrite. They are unused now; leaving them in place doesn't break anything but they're dead configuration that will confuse the next person who looks at the App Service settings.

## Known limitations

- **Single-instance only.** Rooms and Socket.IO's connection state both live in the Node process's memory — there's no Redis (or other) Socket.IO adapter. Scaling the backend to more than one instance will split rooms across instances and break sync. If you ever put this behind a load balancer, you need sticky sessions (ARR affinity on Azure App Service) at minimum, and a shared adapter to actually go multi-instance.
- **Rooms don't survive a restart.** Any deploy, crash, or manual restart of the backend wipes every active room. There is no persistence layer by design.
- **Both host and listener need YTMD** to get actual synced *playback*. Without it, a listener still sees live now-playing info (track, art, progress) but can't control their own audio.
- Idle rooms are swept automatically: a room with no activity for 2 hours is evicted, and a room that was created but never received a single host update is evicted after a 10-minute grace period (see `backend/src/rooms-store.js`).
- Room codes are 4 digits (`0000`–`9999`, 10,000 total); `POST /createRoom` returns `503` if every code is currently in use.
