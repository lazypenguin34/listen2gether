import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import Home from './pages/Home';
import Room from './pages/Room';
import Admin from './pages/Admin';
import NotFound from './pages/NotFound';

// Keys Room by roomCode so navigating from one room straight to another
// (e.g. /room/1111 -> /room/2222) remounts it instead of reusing state —
// every hook's state then starts fresh from its initializer, so no stale
// track data from the previous room can linger.
function RoomRoute() {
  const { roomCode } = useParams();
  return <Room key={roomCode} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomCode" element={<RoomRoute />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
