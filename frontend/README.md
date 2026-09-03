# listen2gether frontend

React 19 + Vite single-page app for listen2gether. See the [repo root README](../README.md) for what the app does, prerequisites (YouTube Music Desktop with its Companion Server enabled), setup, the API/socket reference, and deployment.

## Layout

- `src/pages/` — routed screens: `Home.jsx` (create/join a room), `Room.jsx` (now-playing + sync), `Admin.jsx` (token-gated room list).
- `src/lib/` — everything else: `config.js` (every tunable constant and env var), `ytmd.js` (YouTube Music Desktop companion API client), `useRoomSocket.js` (Socket.IO connection + room state), `useYtmdHost.js` / `useYtmdListener.js` (the two sync loops), `playback.js` (position interpolation math, mirrors the backend), `hostSecret.js` (per-room host secret storage).
- `src/components/` — presentational pieces used by the pages above.

## Commands

Run from this directory:

```bash
npm install
npm run dev      # vite dev server, http://localhost:5173
npm run build    # production build to dist/
npm run preview  # preview a production build locally
npm run test     # vitest run
npm run lint     # see note below
npm run format   # prettier --write, covers ../backend/src too
```

`npm run lint` is not a plain frontend-only lint: it `cd`s up to the repo root and runs ESLint from this package's `node_modules` against both `backend/src` and `frontend/src` using the shared root `eslint.config.mjs`. Run it from here, but expect it to report on backend code too.

Environment variables (`VITE_BACKEND_URL`, `VITE_YTMD_URL`) are documented in [`.env.example`](.env.example) and in the root README's [Configuration](../README.md#configuration) section.
