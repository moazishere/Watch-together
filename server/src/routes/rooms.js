// The only room actions that go through Express: they have realtime or
// screen-share (LiveKit) side effects. Creating rooms, inviting and listing happen in the browser
// directly against Supabase (Row Level Security).
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { getStore, isUuid } from '../store.js';
import { conflict, forbidden, notFound } from '../lib/http.js';
import { endRoom, loadRoomForUser } from '../services/rooms.js';
import { createCallToken } from '../services/livekit.js';
import { hub } from '../realtime/roomHub.js';

const router = Router();
router.use(requireAuth);

// How many people are in each room right now: GET /api/rooms/presence?ids=a,b
router.get('/presence', async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 100);
  const allowed = await getStore().accessibleRoomIds(req.user.id, ids);
  res.json({ online: Object.fromEntries(allowed.map((id) => [id, hub.onlineCount(id)])) });
});

// waiting -> live. Participants then fetch call tokens and join the LiveKit room.
router.post('/:id/start', async (req, res) => {
  const { room, isHost } = await loadRoomForUser(req.params.id, req.user.id);
  if (!isHost) throw forbidden('Only the host can start the session');
  if (room.status === 'ended') throw conflict('This room has ended');
  if (await getStore().markRoomLive(room.id)) hub.markLive(room.id);
  res.json({ status: 'live' });
});

// Credentials for joining the room's LiveKit call (voice chat from the moment
// you enter, screen share once the session is live): { url, token }.
router.post('/:id/call', async (req, res) => {
  const { room, isHost } = await loadRoomForUser(req.params.id, req.user.id);
  if (room.status === 'ended') throw conflict('This room has ended');
  res.json(await createCallToken({ watchRoomId: room.id, user: req.user, isHost }));
});

router.post('/:id/end', async (req, res) => {
  const { isHost } = await loadRoomForUser(req.params.id, req.user.id);
  if (!isHost) throw forbidden('Only the host can end the room');
  await endRoom(req.params.id, 'host_ended');
  res.json({ status: 'ended' });
});

// Revoking goes through the server so the person is also removed from the live room.
router.delete('/:id/invites/:userId', async (req, res) => {
  const { room, isHost } = await loadRoomForUser(req.params.id, req.user.id);
  if (!isHost) throw forbidden('Only the host can remove invites');
  if (!isUuid(req.params.userId)) throw notFound('No such invite');
  await getStore().deleteInvite(room.id, req.params.userId);
  hub.kick(room.id, req.params.userId);
  res.status(204).end();
});

export default router;
