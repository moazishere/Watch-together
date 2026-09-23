// Direct Supabase reads and writes from the browser. Row Level Security
// decides what each call may see or change.
import { supabase } from './supabase.js';

const UNIQUE_VIOLATION = '23505';
const RLS_VIOLATION = '42501';

function must({ data, error }, messages = {}) {
  if (error) throw new Error(messages[error.code] ?? error.message);
  return data;
}

const environmentDto = (e) => ({
  id: e.id,
  name: e.name,
  assetConfig: e.asset_config,
  screenPosition: e.screen_position,
  walkableBounds: e.walkable_bounds,
});

const roomDto = (r) => ({
  id: r.id,
  status: r.status,
  createdAt: r.created_at,
  host: { id: r.host.id, name: r.host.name },
  environment: { id: r.environment.id, name: r.environment.name },
});

export async function listEnvironments() {
  const rows = must(
    await supabase
      .from('environments')
      .select('id, name, asset_config, screen_position, walkable_bounds')
      .order('created_at')
      .order('name'),
  );
  return rows.map(environmentDto);
}

// Open rooms you host or were invited to (RLS hides the rest).
export async function listRooms() {
  const rows = must(
    await supabase
      .from('watch_rooms')
      .select('id, status, created_at, host:profiles!host_user_id(id, name), environment:environments(id, name)')
      .neq('status', 'ended')
      .order('created_at', { ascending: false }),
  );
  return rows.map(roomDto);
}

export async function createRoom(hostUserId, environmentId) {
  return must(
    await supabase.from('watch_rooms').insert({ host_user_id: hostUserId, environment_id: environmentId }).select('id').single(),
    { [RLS_VIOLATION]: "That environment isn't available yet" },
  );
}

// Everything the room page needs, or null if it doesn't exist / isn't yours.
export async function getRoom(roomId) {
  const { data, error } = await supabase
    .from('watch_rooms')
    .select(
      `id, status, created_at, host:profiles!host_user_id(id, name),
       environment:environments(id, name, asset_config, screen_position, walkable_bounds),
       invites:watch_room_invites(invited_at, user:profiles(id, name))`,
    )
    .eq('id', roomId)
    .maybeSingle();
  if (error?.code === '22P02') return null; // not a UUID
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...roomDto(data),
    environment: environmentDto(data.environment),
    // Only the host sees everyone's invites; an invitee sees just their own.
    invites: data.invites
      .sort((a, b) => a.invited_at.localeCompare(b.invited_at))
      .map((i) => ({ id: i.user.id, name: i.user.name })),
  };
}

export async function inviteToRoom(roomId, userId) {
  const { error } = await supabase.from('watch_room_invites').insert({ room_id: roomId, user_id: userId });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(error.code === RLS_VIOLATION ? 'You can only invite friends into an open room' : error.message);
  }
}

// Marks that you joined the room (once per room; repeats are ignored).
export async function recordJoin(roomId, userId) {
  const { error } = await supabase.from('watch_room_participants').insert({ room_id: roomId, user_id: userId });
  if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
}

export async function listFriends() {
  const rows = must(await supabase.rpc('list_friends'));
  const person = (r) => ({ id: r.id, name: r.name, email: r.email });
  return {
    friends: rows.filter((r) => r.status === 'accepted').map(person),
    incoming: rows.filter((r) => r.status === 'pending' && r.direction === 'incoming').map(person),
    outgoing: rows.filter((r) => r.status === 'pending' && r.direction === 'outgoing').map(person),
  };
}

// Returns 'pending' (request sent) or 'accepted' (they had already asked you).
export async function requestFriend(email) {
  return must(await supabase.rpc('request_friend', { friend_email: email }));
}

export async function acceptFriend(requesterId, myId) {
  must(await supabase.from('friendships').update({ status: 'accepted' }).eq('user_id', requesterId).eq('friend_id', myId));
}

// Decline, cancel or unfriend: removes the row in either direction.
export async function removeFriend(otherId, myId) {
  must(
    await supabase
      .from('friendships')
      .delete()
      .or(`and(user_id.eq.${myId},friend_id.eq.${otherId}),and(user_id.eq.${otherId},friend_id.eq.${myId})`),
  );
}
