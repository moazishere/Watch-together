import { getStore } from '../store.js';
import { forbidden, notFound } from '../lib/http.js';
import { deleteLiveKitRoom } from './livekit.js';
import { hub } from '../realtime/roomHub.js';

// Loads a room plus the caller's relationship to it. Throws 404 if it doesn't
// exist and 403 if the user is neither the host nor invited.
export async function loadRoomForUser(roomId, userId) {
  const store = getStore();
  const room = await store.getRoom(roomId);
  if (!room) throw notFound('Room not found');
  const isHost = room.hostUserId === userId;
  if (!isHost && !(await store.isInvited(room.id, userId))) throw forbidden('You have not been invited to this room');
  return { room, isHost };
}

// Ends a room for everyone: DB status, socket broadcast, LiveKit room teardown.
// Safe to call more than once.
export async function endRoom(roomId, reason = 'host_ended') {
  if (!(await getStore().markRoomEnded(roomId))) return false;
  hub.endRoom(roomId, reason);
  await deleteLiveKitRoom(roomId).catch((err) => console.warn('LiveKit cleanup failed', err));
  return true;
}
