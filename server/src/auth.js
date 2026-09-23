import { getStore } from './store.js';
import { unauthorized } from './lib/http.js';

// Returns { id, name } for a valid Supabase access token, or throws a 401.
export async function authenticate(token) {
  const store = getStore();
  const userId = await store.verifyToken(token);
  if (!userId) throw unauthorized('Invalid or expired session');
  const profile = await store.getProfile(userId);
  if (!profile) throw unauthorized('Account no longer exists');
  return profile;
}

// Express middleware: requires "Authorization: Bearer <supabase access token>".
export async function requireAuth(req, _res, next) {
  try {
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    req.user = await authenticate(token);
    next();
  } catch (err) {
    next(err);
  }
}
