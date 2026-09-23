import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';

// Mirrors the Supabase Auth session. `user` is the app-level view:
// { id, email, name } with the name taken from public.profiles.
export const useAuth = create((set) => ({
  ready: false,
  session: null,
  user: null,
  logout: () => supabase.auth.signOut(),
  setName: (name) => set((s) => (s.user ? { user: { ...s.user, name } } : s)),
}));

async function loadProfile(session) {
  const { data } = await supabase.from('profiles').select('name').eq('id', session.user.id).maybeSingle();
  // Ignore the result if the user changed while we were fetching.
  if (useAuth.getState().session?.user.id !== session.user.id) return;
  useAuth.setState({
    ready: true,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: data?.name ?? session.user.user_metadata?.name ?? session.user.email,
    },
  });
}

if (supabase) {
  // Fires INITIAL_SESSION straight away, then on sign-in, sign-out and token refresh.
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      useAuth.setState({ ready: true, session: null, user: null });
      return;
    }
    const sameUser = useAuth.getState().user?.id === session.user.id;
    useAuth.setState({ session, ...(sameUser ? { ready: true } : {}) });
    // Supabase advises against awaiting other Supabase calls inside this callback.
    if (!sameUser) setTimeout(() => loadProfile(session), 0);
  });
} else {
  useAuth.setState({ ready: true });
}

// Current access token, for the Express API and Socket.io handshakes.
export const accessToken = () => useAuth.getState().session?.access_token ?? null;
