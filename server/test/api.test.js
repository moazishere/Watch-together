// Tests the Express + Socket.io layer with an in-memory store in place of
// Supabase: auth checks, room access, start/end lifecycle, invite revocation,
// and realtime movement/share events. Row Level Security is covered
// separately in rls.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { EVENTS, MAX_REACTIONS_PER_WINDOW, roomNamespace, seatLayout } from '@watch-together/shared';

process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SECRET_KEY ??= 'test';
process.env.HOST_GRACE_MS = '300';
for (const key of ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']) delete process.env[key];

const { createApp } = await import('../src/app.js');
const { hub } = await import('../src/realtime/roomHub.js');
const { setStore } = await import('../src/store.js');

// Night Forest exactly as seeded, so bounds checks use the real clearing.
const seed = await readFile(new URL('../../supabase/migrations/20260923000002_seed_environments.sql', import.meta.url), 'utf8');
const [, assetConfig, screenPosition, walkableBounds] = seed.match(
  /'Night Forest',\s*'([\s\S]*?)'::jsonb,\s*'([\s\S]*?)'::jsonb,\s*'([\s\S]*?)'::jsonb/,
);
const FOREST = randomUUID();

function createMemoryStore() {
  const tokens = new Map();
  const profiles = new Map();
  const rooms = new Map();
  const invites = new Set();
  const environments = new Map([
    [FOREST, { assetConfig: JSON.parse(assetConfig), screenPosition: JSON.parse(screenPosition), walkableBounds: JSON.parse(walkableBounds) }],
  ]);
  const key = (roomId, userId) => `${roomId}:${userId}`;

  return {
    // test helpers
    addUser(name) {
      const id = randomUUID();
      const token = `token-${name}-${id}`;
      profiles.set(id, { id, name });
      tokens.set(token, id);
      return { id, token };
    },
    addRoom(hostUserId) {
      const id = randomUUID();
      rooms.set(id, { id, status: 'waiting', hostUserId, hostName: profiles.get(hostUserId).name, environmentId: FOREST });
      return id;
    },
    invite: (roomId, userId) => invites.add(key(roomId, userId)),
    room: (id) => rooms.get(id),

    // store interface
    verifyToken: async (token) => tokens.get(token) ?? null,
    getProfile: async (id) => profiles.get(id) ?? null,
    getRoom: async (id) => (rooms.has(id) ? { ...rooms.get(id) } : null),
    isInvited: async (roomId, userId) => invites.has(key(roomId, userId)),
    accessibleRoomIds: async (userId, ids) =>
      ids.filter((id) => rooms.get(id)?.hostUserId === userId || invites.has(key(id, userId))),
    getEnvironment: async (id) => environments.get(id) ?? null,
    async markRoomLive(id) {
      const room = rooms.get(id);
      if (room?.status !== 'waiting') return false;
      room.status = 'live';
      return true;
    },
    async markRoomEnded(id) {
      const room = rooms.get(id);
      if (!room || room.status === 'ended') return false;
      room.status = 'ended';
      return true;
    },
    deleteInvite: async (roomId, userId) => invites.delete(key(roomId, userId)),
  };
}

const store = createMemoryStore();
setStore(store);

let server;
let ioServer;
let base;
const sockets = [];

before(async () => {
  server = http.createServer(createApp());
  ioServer = new Server(server, { cleanupEmptyChildNamespaces: true });
  hub.attach(ioServer);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://localhost:${server.address().port}`;
});

after(() => {
  sockets.forEach((s) => s.disconnect());
  ioServer.close();
});

async function api(method, path, token) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}

function open(roomId, token) {
  const socket = connect(`${base}${roomNamespace(roomId)}`, { auth: { token }, transports: ['websocket'] });
  sockets.push(socket);
  return socket;
}

function joinRoom(roomId, token) {
  const socket = open(roomId, token);
  const state = new Promise((resolve, reject) => {
    socket.once(EVENTS.ROOM_STATE, resolve);
    socket.once('connect_error', reject);
  });
  return { socket, state };
}

const nextEvent = (socket, event, timeout = 2000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

const alice = store.addUser('Alice');
const bob = store.addUser('Bob');
const eve = store.addUser('Eve');

test('config and auth', async () => {
  assert.deepEqual((await api('GET', '/config')).data, { screenShare: false, voice: false });
  const roomId = store.addRoom(alice.id);
  assert.equal((await api('POST', `/rooms/${roomId}/start`)).status, 401);
  assert.equal((await api('POST', `/rooms/${roomId}/start`, 'garbage')).status, 401);
  assert.equal((await api('POST', `/rooms/${randomUUID()}/start`, alice.token)).status, 404);
  assert.equal((await api('POST', '/rooms/not-a-uuid/start', alice.token)).status, 404);
});

test('host-only actions and access control', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);
  assert.equal((await api('POST', `/rooms/${roomId}/start`, bob.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${roomId}/end`, bob.token)).status, 403);
  assert.equal((await api('POST', `/rooms/${roomId}/start`, eve.token)).status, 403);
  // Voice works before the session starts, so /call is allowed while waiting
  // (503 here only because LiveKit isn't configured in tests).
  assert.equal((await api('POST', `/rooms/${roomId}/call`, bob.token)).status, 503);
  assert.equal((await api('POST', `/rooms/${roomId}/call`, eve.token)).status, 403);

  const presence = await api('GET', `/rooms/presence?ids=${roomId},${randomUUID()}`, eve.token);
  assert.deepEqual(presence.data.online, {}, 'no presence for rooms you cannot access');

  assert.equal((await api('POST', `/rooms/${roomId}/start`, alice.token)).status, 200);
  assert.equal(store.room(roomId).status, 'live');
  // Without LiveKit credentials the call endpoint explains that screen share is off.
  assert.equal((await api('POST', `/rooms/${roomId}/call`, bob.token)).status, 503);
});

test('socket: join, see each other, move, bounds enforced, share events, leave', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);

  const bad = open(roomId, 'nope');
  assert.match((await nextEvent(bad, 'connect_error')).message, /session/i);
  const outsider = open(roomId, eve.token);
  assert.match((await nextEvent(outsider, 'connect_error')).message, /not been invited/);

  const a = joinRoom(roomId, alice.token);
  const aliceState = await a.state;
  assert.equal(aliceState.players.length, 1);
  assert.equal(aliceState.room.status, 'waiting');

  const aliceSeesBob = nextEvent(a.socket, EVENTS.PLAYER_JOIN);
  const b = joinRoom(roomId, bob.token);
  const bobState = await b.state;
  assert.equal(bobState.players.length, 2);
  assert.equal((await aliceSeesBob).name, 'Bob');

  const presence = await api('GET', `/rooms/presence?ids=${roomId}`, bob.token);
  assert.deepEqual(presence.data.online, { [roomId]: 2 });

  // A normal move is relayed as-is.
  const self = bobState.players.find((p) => p.id === bob.id);
  const moved = nextEvent(a.socket, EVENTS.PLAYER_MOVE);
  b.socket.emit(EVENTS.PLAYER_MOVE, { x: self.x + 0.5, y: 0, z: self.z - 0.5, rotationY: 1 });
  const m = await moved;
  assert.equal(m.id, bob.id);
  assert.ok(Math.abs(m.x - (self.x + 0.5)) < 1e-9);

  // A teleport far outside the clearing is capped and kept inside the bounds.
  const clamped = nextEvent(a.socket, EVENTS.PLAYER_MOVE);
  b.socket.emit(EVENTS.PLAYER_MOVE, { x: 500, y: 0, z: 500, rotationY: 0 });
  const c = await clamped;
  assert.ok(Math.hypot(c.x - m.x, c.z - m.z) <= 3 + 1e-9);
  assert.ok(c.x < 15 && c.z < 14);

  // Share events are host-only.
  let bobShareRelayed = false;
  a.socket.once(EVENTS.HOST_STARTED_SHARE, () => (bobShareRelayed = true));
  b.socket.emit(EVENTS.HOST_STARTED_SHARE);
  const shareSeen = nextEvent(b.socket, EVENTS.HOST_STARTED_SHARE);
  a.socket.emit(EVENTS.HOST_STARTED_SHARE);
  await shareSeen;
  assert.equal(bobShareRelayed, false);

  const left = nextEvent(a.socket, EVENTS.PLAYER_LEAVE);
  b.socket.disconnect();
  assert.equal((await left).id, bob.id);

  const rejoin = joinRoom(roomId, bob.token);
  assert.equal((await rejoin.state).room.sharing, true, 'late joiners learn the share is running');

  // Revoking Bob's invite removes him from the live room.
  const kicked = nextEvent(a.socket, EVENTS.PLAYER_LEAVE);
  assert.equal((await api('DELETE', `/rooms/${roomId}/invites/${bob.id}`, alice.token)).status, 204);
  assert.equal((await kicked).id, bob.id);
  assert.match((await nextEvent(open(roomId, bob.token), 'connect_error')).message, /not been invited/);
  a.socket.disconnect();
});

test('start session, end room', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);
  const a = joinRoom(roomId, alice.token);
  await a.state;

  const live = nextEvent(a.socket, EVENTS.ROOM_LIVE);
  assert.equal((await api('POST', `/rooms/${roomId}/start`, alice.token)).status, 200);
  await live;

  const ended = nextEvent(a.socket, EVENTS.ROOM_ENDED);
  assert.equal((await api('POST', `/rooms/${roomId}/end`, alice.token)).status, 200);
  assert.equal((await ended).reason, 'host_ended');
  assert.equal(store.room(roomId).status, 'ended');

  assert.match((await nextEvent(open(roomId, bob.token), 'connect_error')).message, /ended/);
});

test('room ends automatically when the host leaves', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);
  const a = joinRoom(roomId, alice.token);
  const b = joinRoom(roomId, bob.token);
  await Promise.all([a.state, b.state]);
  const ended = nextEvent(b.socket, EVENTS.ROOM_ENDED);
  a.socket.disconnect();
  assert.equal((await ended).reason, 'host_left');
  assert.equal(store.room(roomId).status, 'ended');
});

test('seats: sit within reach, one person per seat, late joiners see it, stand and leave free it', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);
  const { seats } = seatLayout(JSON.parse(screenPosition));
  const seat = seats[0];
  const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  const walkTo = async (socket, from, to) => {
    // Step in <= 3 m increments like a real client would.
    let { x, z } = from;
    while (Math.hypot(to.x - x, to.z - z) > 0.01) {
      const d = Math.hypot(to.x - x, to.z - z);
      const k = Math.min(1, 2.5 / d);
      x += (to.x - x) * k;
      z += (to.z - z) * k;
      socket.emit(EVENTS.PLAYER_MOVE, { x, y: 0, z, rotationY: 0 });
      await new Promise((r) => setTimeout(r, 40));
    }
  };

  const a = joinRoom(roomId, alice.token);
  const aliceState = await a.state;
  const aliceSelf = aliceState.players[0];

  const far = await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: seats[seats.length - 1].id });
  if (Math.hypot(seats[seats.length - 1].x - aliceSelf.x, seats[seats.length - 1].z - aliceSelf.z) > 2.5) {
    assert.deepEqual(far, { ok: false, error: 'Too far from that seat' });
  }
  assert.equal((await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: 'nope' })).ok, false);

  await walkTo(a.socket, aliceSelf, { x: seat.x, z: seat.z + 1 });
  const sat = await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: seat.id });
  assert.equal(sat.ok, true);
  assert.equal(sat.seat.id, seat.id);

  // Moves are ignored while seated.
  a.socket.emit(EVENTS.PLAYER_MOVE, { x: seat.x + 1, y: 0, z: seat.z, rotationY: 0 });

  const b = joinRoom(roomId, bob.token);
  const bobState = await b.state;
  const aliceSeen = bobState.players.find((p) => p.id === alice.id);
  assert.equal(aliceSeen.seatId, seat.id, 'late joiner sees who is seated');
  assert.ok(Math.abs(aliceSeen.x - seat.x) < 1e-9 && Math.abs(aliceSeen.z - seat.z) < 1e-9);

  const bobSelf = bobState.players.find((p) => p.id === bob.id);
  await walkTo(b.socket, bobSelf, { x: seat.x, z: seat.z + 1 });
  assert.deepEqual(await emitAck(b.socket, EVENTS.PLAYER_SIT, { seatId: seat.id }), { ok: false, error: 'Someone is already sitting there' });

  const stood = nextEvent(b.socket, EVENTS.PLAYER_STAND);
  a.socket.emit(EVENTS.PLAYER_STAND);
  assert.equal((await stood).id, alice.id);

  const bobSits = nextEvent(a.socket, EVENTS.PLAYER_SIT);
  assert.equal((await emitAck(b.socket, EVENTS.PLAYER_SIT, { seatId: seat.id })).ok, true);
  assert.deepEqual(await bobSits, { id: bob.id, seatId: seat.id, x: seat.x, z: seat.z, rotationY: seat.rotationY });

  // Leaving frees the seat for others.
  const bobLeft = nextEvent(a.socket, EVENTS.PLAYER_LEAVE);
  b.socket.disconnect();
  await bobLeft;
  await walkTo(a.socket, { x: seat.x, z: seat.z }, { x: seat.x, z: seat.z + 1 });
  assert.equal((await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: seat.id })).ok, true);
  a.socket.disconnect();
});

test('seats: works right after (re)connecting without moving; sit requests cannot teleport', async () => {
  const roomId = store.addRoom(alice.id);
  const { seats } = seatLayout(JSON.parse(screenPosition));
  const emitAck = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

  // Fresh connection: the server put us at a spawn point, but the client says it
  // is standing right by a seat (e.g. after the server restarted). Trust it once.
  const a = joinRoom(roomId, alice.token);
  await a.state;
  const near = seats[0];
  const sat = await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: near.id, x: near.x, z: near.z + 0.5 });
  assert.equal(sat.ok, true, 'first position update after connecting is accepted');
  a.socket.emit(EVENTS.PLAYER_STAND);

  // From then on positions are step-capped: claiming to be at a far seat fails.
  const far = seats.reduce((best, s) => (Math.hypot(s.x - near.x, s.z - near.z) > Math.hypot(best.x - near.x, best.z - near.z) ? s : best));
  assert.ok(Math.hypot(far.x - near.x, far.z - near.z) > 3 + 2.5);
  assert.deepEqual(await emitAck(a.socket, EVENTS.PLAYER_SIT, { seatId: far.id, x: far.x, z: far.z }), {
    ok: false,
    error: 'Too far from that seat',
  });
  a.socket.disconnect();
});

test('reactions: relayed to others with the sender id, invalid ones dropped, spam capped', async () => {
  const roomId = store.addRoom(alice.id);
  store.invite(roomId, bob.id);
  const a = joinRoom(roomId, alice.token);
  const b = joinRoom(roomId, bob.token);
  await Promise.all([a.state, b.state]);

  const received = [];
  b.socket.on(EVENTS.PLAYER_REACT, (r) => received.push(r));
  let echoedToSender = false;
  a.socket.on(EVENTS.PLAYER_REACT, () => (echoedToSender = true));

  a.socket.emit(EVENTS.PLAYER_REACT, { reaction: 1 });
  a.socket.emit(EVENTS.PLAYER_REACT, { reaction: 99 }); // unknown
  a.socket.emit(EVENTS.PLAYER_REACT, { reaction: '2' }); // wrong type
  a.socket.emit(EVENTS.PLAYER_REACT, null);
  for (let i = 0; i < MAX_REACTIONS_PER_WINDOW + 4; i++) a.socket.emit(EVENTS.PLAYER_REACT, { reaction: 4 });
  await new Promise((r) => setTimeout(r, 300));

  assert.deepEqual(received[0], { id: alice.id, reaction: 1 });
  assert.equal(received.length, MAX_REACTIONS_PER_WINDOW, 'valid reactions beyond the window limit are dropped');
  assert.ok(received.every((r) => r.id === alice.id && [1, 4].includes(r.reaction)));
  assert.equal(echoedToSender, false, 'the sender shows its own reaction locally');
  a.socket.disconnect();
  b.socket.disconnect();
});
