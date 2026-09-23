import { accessToken } from '../state/auth.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Calls the Express server (realtime / screen-share actions only; plain data goes
// straight to Supabase, see data.js).
export async function api(path, { method = 'GET' } = {}) {
  const token = accessToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // No JSON body means the request never reached Express (in dev, Vite's
    // proxy answers 500/502/504 when nothing is listening on port 4000).
    if (!data) {
      throw new ApiError(res.status, "Can't reach the game server. Start it with `npm run dev` (runs server + client).");
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  return data;
}
