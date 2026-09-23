// Socket.io room namespaces: one dynamic namespace per watch room, /room/:roomId.
// Holds the in-memory state of who is in each room and where they stand.
// Positions and share events never touch the database: Supabase is only read
// when a socket connects (auth + room access) and when a room ends.
import {
  EVENTS,
  MAX_MOVE_EVENTS_PER_SEC,
  MAX_REACTIONS_PER_WINDOW,
  MAX_STEP_DISTANCE,
  REACTIONS,
  REACTION_WINDOW_MS,
  SIT_REACH,
  constrainMove,
  nearestInside,
  pickSpawnPoint,
  seatLayout,
} from '@watch-together/shared';
import { config } from '../config.js';
import { authenticate } from '../auth.js';
import { getStore } from '../store.js';
import { endRoom, loadRoomForUser } from '../services/rooms.js';

const NAMESPACE_PATTERN = /^\/room\/([0-9a-f-]{36})$/i;

// roomId -> { nsp, hostId, status, sharing, bounds, spawn, screen, seats: Map<seatId, seat>,
//             seatedBy: Map<seatId, userId>, players: Map<userId, player>, hostGraceTimer }
const rooms = new Map();

function getOrCreateState(nsp, room, env) {
  let state = rooms.get(room.id);
  if (!state) {
    state = {
      nsp,
      hostId: room.hostUserId,
      status: room.status,
      sharing: false,
      bounds: env.walkableBounds,
      spawn: env.assetConfig?.spawn ?? { x: 0, z: 0 },
      screen: env.screenPosition,
      seats: new Map(seatLayout(env.screenPosition, env.assetConfig?.seats).seats.map((seat) => [seat.id, seat])),
      seatedBy: new Map(),
      players: new Map(),
      hostGraceTimer: null,
    };
    rooms.set(room.id, state);
  }
  // Empty child namespaces are cleaned up, so the namespace may be a new instance.
  state.nsp = nsp;
  return state;
}

const publicPlayer = (p) => ({
  id: p.userId,
  name: p.name,
  isHost: p.isHost,
  x: p.x,
  y: p.y,
  z: p.z,
  rotationY: p.rotationY,
  seatId: p.seatId,
});

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// Initial facing: towards the screen. Three.js objects look down -Z at rotationY = 0.
function facingScreen(screen, x, z) {
  if (!screen) return 0;
  return Math.atan2(-(screen.x - x), -(screen.z - z));
}

async function authenticateSocket(socket, next) {
  try {
    const [, roomId] = socket.nsp.name.match(NAMESPACE_PATTERN);
    const user = await authenticate(socket.handshake.auth?.token);
    const { room, isHost } = await loadRoomForUser(roomId, user.id);
    if (room.status === 'ended') throw new Error('This room has ended');
    const env = await getStore().getEnvironment(room.environmentId);

    socket.data.user = user;
    socket.data.roomId = roomId;
    socket.data.isHost = isHost;
    socket.data.state = getOrCreateState(socket.nsp, room, env);
    next();
  } catch (err) {
    next(new Error(err.message || 'Unauthorized'));
  }
}

function onConnection(socket) {
  const { user, roomId, isHost, state } = socket.data;

  // Same user in a second tab: the newest connection wins.
  const previous = state.players.get(user.id);
  if (previous) {
    if (previous.seatId) state.seatedBy.delete(previous.seatId);
    state.nsp.sockets.get(previous.socketId)?.disconnect();
  }

  if (isHost && state.hostGraceTimer) {
    clearTimeout(state.hostGraceTimer);
    state.hostGraceTimer = null;
  }

  const spawn = pickSpawnPoint(state.bounds, state.spawn);
  const player = {
    socketId: socket.id,
    userId: user.id,
    name: user.name,
    isHost,
    x: spawn.x,
    y: 0,
    z: spawn.z,
    rotationY: facingScreen(state.screen, spawn.x, spawn.z),
    seatId: null,
    // The client keeps its own position across reconnects, so its first
    // update after connecting is taken as-is (within bounds) rather than
    // step-capped from the spawn point we picked.
    synced: false,
    reactionTimes: [],
    moveWindowStart: 0,
    moveCount: 0,
  };
  state.players.set(user.id, player);

  socket.emit(EVENTS.ROOM_STATE, {
    selfId: user.id,
    players: [...state.players.values()].map(publicPlayer),
    room: { id: roomId, status: state.status, hostId: state.hostId, sharing: state.sharing },
  });
  socket.broadcast.emit(EVENTS.PLAYER_JOIN, publicPlayer(player));

  const freeSeat = () => {
    if (!player.seatId) return false;
    state.seatedBy.delete(player.seatId);
    player.seatId = null;
    return true;
  };

  // Moves the player towards the reported position: capped step (except the
  // first update after connecting), then kept inside the walkable bounds.
  const applyMove = (msg) => {
    let { x, z } = msg;
    if (player.synced) {
      const dx = x - player.x;
      const dz = z - player.z;
      const dist = Math.hypot(dx, dz);
      if (dist > MAX_STEP_DISTANCE) {
        x = player.x + (dx / dist) * MAX_STEP_DISTANCE;
        z = player.z + (dz / dist) * MAX_STEP_DISTANCE;
      }
    }
    const next = player.synced ? constrainMove(state.bounds, player.x, player.z, x, z) : nearestInside(state.bounds, x, z);
    player.synced = true;
    player.x = next.x;
    player.z = next.z;
    player.y = isFiniteNumber(msg.y) ? Math.max(0, Math.min(3, msg.y)) : 0;
    if (isFiniteNumber(msg.rotationY)) player.rotationY = msg.rotationY;
  };

  socket.on(EVENTS.PLAYER_MOVE, (msg) => {
    if (state.players.get(user.id) !== player) return;
    if (player.seatId) return; // seated players stay put until they stand
    if (!msg || ![msg.x, msg.z, msg.rotationY].every(isFiniteNumber)) return;

    // Rate limit: drop anything above MAX_MOVE_EVENTS_PER_SEC.
    const now = Date.now();
    if (now - player.moveWindowStart >= 1000) {
      player.moveWindowStart = now;
      player.moveCount = 0;
    }
    if (++player.moveCount > MAX_MOVE_EVENTS_PER_SEC) return;

    applyMove(msg);
    socket.broadcast.volatile.emit(EVENTS.PLAYER_MOVE, {
      id: user.id,
      x: player.x,
      y: player.y,
      z: player.z,
      rotationY: player.rotationY,
    });
  });

  // Take a seat: it must exist, be free, and be within reach. The request
  // carries the client's current position (applied like a move first), so a
  // dropped or throttled move update can't make a nearby seat look too far.
  // Replies via ack.
  socket.on(EVENTS.PLAYER_SIT, (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (state.players.get(user.id) !== player) return reply({ ok: false, error: 'Not in the room' });
    const seat = state.seats.get(msg?.seatId);
    if (!seat) return reply({ ok: false, error: 'No such seat' });
    if (!player.seatId && isFiniteNumber(msg.x) && isFiniteNumber(msg.z)) applyMove({ x: msg.x, z: msg.z });
    const holder = state.seatedBy.get(seat.id);
    if (holder && holder !== user.id) return reply({ ok: false, error: 'Someone is already sitting there' });
    if (Math.hypot(seat.x - player.x, seat.z - player.z) > SIT_REACH) return reply({ ok: false, error: 'Too far from that seat' });

    freeSeat();
    state.seatedBy.set(seat.id, user.id);
    player.seatId = seat.id;
    player.x = seat.x;
    player.y = 0;
    player.z = seat.z;
    player.rotationY = seat.rotationY;
    socket.broadcast.emit(EVENTS.PLAYER_SIT, { id: user.id, seatId: seat.id, x: seat.x, z: seat.z, rotationY: seat.rotationY });
    reply({ ok: true, seat });
  });

  socket.on(EVENTS.PLAYER_STAND, () => {
    if (state.players.get(user.id) !== player) return;
    if (freeSeat()) socket.broadcast.emit(EVENTS.PLAYER_STAND, { id: user.id });
  });

  // Emoji reactions: relayed to everyone else, never stored. Only known
  // reactions, and at most MAX_REACTIONS_PER_WINDOW per player per window.
  socket.on(EVENTS.PLAYER_REACT, (msg) => {
    if (state.players.get(user.id) !== player) return;
    const reaction = msg?.reaction;
    if (!Number.isInteger(reaction) || reaction < 0 || reaction >= REACTIONS.length) return;
    const now = Date.now();
    player.reactionTimes = player.reactionTimes.filter((t) => now - t < REACTION_WINDOW_MS);
    if (player.reactionTimes.length >= MAX_REACTIONS_PER_WINDOW) return;
    player.reactionTimes.push(now);
    socket.broadcast.emit(EVENTS.PLAYER_REACT, { id: user.id, reaction });
  });

  socket.on(EVENTS.HOST_STARTED_SHARE, () => {
    if (!isHost || state.sharing) return;
    state.sharing = true;
    socket.broadcast.emit(EVENTS.HOST_STARTED_SHARE, { hostId: user.id });
  });

  socket.on(EVENTS.HOST_STOPPED_SHARE, () => {
    if (!isHost || !state.sharing) return;
    state.sharing = false;
    socket.broadcast.emit(EVENTS.HOST_STOPPED_SHARE, { hostId: user.id });
  });

  socket.on('disconnect', () => {
    if (state.players.get(user.id) !== player) return; // replaced by a newer tab
    freeSeat();
    state.players.delete(user.id);
    socket.broadcast.emit(EVENTS.PLAYER_LEAVE, { id: user.id });

    if (isHost) {
      if (state.sharing) {
        state.sharing = false;
        socket.broadcast.emit(EVENTS.HOST_STOPPED_SHARE, { hostId: user.id });
      }
      // Give the host a moment to come back (page refresh, flaky Wi-Fi) before
      // ending the room for everyone.
      state.hostGraceTimer = setTimeout(() => {
        state.hostGraceTimer = null;
        endRoom(roomId, 'host_left').catch((err) => console.error('endRoom failed', err));
      }, config.hostGraceMs);
    } else if (state.players.size === 0 && !state.hostGraceTimer) {
      rooms.delete(roomId);
    }
  });
}

export const hub = {
  attach(io) {
    const parent = io.of(NAMESPACE_PATTERN);
    parent.use(authenticateSocket);
    parent.on('connection', onConnection);
  },

  onlineCount(roomId) {
    return rooms.get(roomId)?.players.size ?? 0;
  },

  markLive(roomId) {
    const state = rooms.get(roomId);
    if (!state) return;
    state.status = 'live';
    state.nsp.emit(EVENTS.ROOM_LIVE, { status: 'live' });
  },

  endRoom(roomId, reason) {
    const state = rooms.get(roomId);
    if (!state) return;
    clearTimeout(state.hostGraceTimer);
    rooms.delete(roomId);
    state.nsp.emit(EVENTS.ROOM_ENDED, { reason });
    // Graceful disconnect so the room:ended packet above is delivered first.
    state.nsp.disconnectSockets();
  },

  // Removes a user from a room (e.g. their invite was revoked).
  kick(roomId, userId) {
    const state = rooms.get(roomId);
    const player = state?.players.get(userId);
    if (player) state.nsp.sockets.get(player.socketId)?.disconnect();
  },
};
