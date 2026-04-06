# Listen2Gether

Listen2Gether is a web application that allows users to host and join real-time listening parties. It synchronizes music playback across different clients and supports both **Spotify** and **YouTube Music**.

## Features

- **Spotify Integration:** Host a room by logging into your Spotify account. Listen2Gether polls your currently playing track and synchronizes the playback state for all listeners in the room.
- **YouTube Music Desktop (YTMD) Integration:** Host a room via the YouTube Music Desktop application. The YTMD companion server actively pushes playback updates to the backend.
- **Real-Time Synchronization:** Listeners can see the currently playing track, artist name, and album artwork updated in near real-time.
- **Host & Listener Roles:** Distinct user experiences based on whether you are broadcasting your music or tuning in to the party.

## Tech Stack

### Frontend
- React 19
- Vite
- React Router DOM
- Axios

### Backend
- Node.js
- Express
- CORS & Cookie Parser
- Crypto (for secure token and room code generation)

## Project Structure

The repository is structured as a monorepo consisting of:
- `frontend/` - Contains the React single-page application.
- `backend/` - Contains the Node.js/Express backend service.
- `package.json` - Root package to concurrently run both projects during development.

## Setup & Running Locally

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn
- A Spotify Developer Dashboard application (for `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`)

### 1. Install Dependencies
Install dependencies for both frontend and backend.
```bash
# Root dependencies
npm install

# Backend dependencies
cd backend && npm install

# Frontend dependencies
cd ../frontend && npm install
```

### 2. Configure Environment Variables

**Backend (`backend/.env` or system environment variables):**
```env
PORT=8888
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
FRONTEND_URL=http://localhost:5173
BACKEND_URL=http://localhost:8888
```

**Frontend (`frontend/.env`):**
```env
VITE_BACKEND_URL=http://localhost:8888
```

### 3. Start Development Servers
From the root of the project, run:
```bash
npm run dev
```
This leverages `concurrently` to start both the frontend (on port 5173) and backend (on port 8888) at the same time.

- Frontend will be accessible at: `http://localhost:5173`
- Backend will be accessible at: `http://localhost:8888`

## API Endpoints Overview

- `GET /spotifyLogin` - Initiates the Spotify OAuth flow for a host or listener.
- `GET /callback` - Handles the OAuth callback, fetches tokens, creates/updates the room, and redirects the user.
- `GET /room/:roomCode` - Look up generic information and playback status for a specific room (strips sensitive tokens).
- `POST /createYTRoom` - Creates a new room for YouTube Music Desktop hosts.
- `POST /updateYTRoom/:roomCode` - Called by the YTMD companion app to push playback state changes to the room.
- `GET /getRooms` - Admin API to view all currently active rooms.

## Deployment
This project is configured out-of-the-box for deployment on Azure:
- The backend is hosted as an Azure App Service.
- The frontend is published through Azure Static Web Apps.
(Production URL overwrites are automatically applied in the backend unless explicitly provided).
