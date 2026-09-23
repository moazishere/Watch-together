import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/auth.js';
import { supabaseConfigured } from './lib/supabase.js';
import AuthPage from './pages/AuthPage.jsx';
import LobbyPage from './pages/LobbyPage.jsx';
import PreviewPage from './pages/PreviewPage.jsx';
import RoomPage from './pages/RoomPage.jsx';

function RequireAuth({ children }) {
  const signedIn = useAuth((s) => Boolean(s.user));
  const location = useLocation();
  if (!signedIn) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

// Login/signup pages. Once the session and profile are loaded, go back to
// wherever the user was heading.
function GuestOnly({ children }) {
  const signedIn = useAuth((s) => Boolean(s.user));
  const location = useLocation();
  return signedIn ? <Navigate to={location.state?.from ?? '/lobby'} replace /> : children;
}

export default function App() {
  const ready = useAuth((s) => s.ready);

  if (!supabaseConfigured) {
    return (
      <main className="page-message">
        <div className="card auth-card">
          <h2>Supabase isn't configured</h2>
          <p className="muted">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env</code> (see
            .env.example), then restart <code>npm run dev</code>.
          </p>
        </div>
      </main>
    );
  }
  if (!ready) return <p className="page-message">Loading…</p>;

  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><AuthPage mode="login" /></GuestOnly>} />
      <Route path="/signup" element={<GuestOnly><AuthPage mode="signup" /></GuestOnly>} />
      <Route path="/lobby" element={<RequireAuth><LobbyPage /></RequireAuth>} />
      <Route path="/room/:roomId" element={<RequireAuth><RoomPage /></RequireAuth>} />
      <Route path="/preview" element={<RequireAuth><PreviewPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/lobby" replace />} />
    </Routes>
  );
}
