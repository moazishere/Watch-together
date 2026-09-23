import { useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { EVENTS, MOVE_SEND_HZ, roomNamespace } from '@watch-together/shared';
import { remoteTransforms, useRoom } from '../state/room.js';
import { accessToken } from '../state/auth.js';
import { reactionBus } from './reactions.js';

const SEND_INTERVAL_MS = 1000 / MOVE_SEND_HZ;
const REACTION_COOLDOWN_MS = 200; // matches the server's spam limit closely enough

const transformOf = (p) => ({ x: p.x, y: p.y, z: p.z, rotationY: p.rotationY });

// Connects to the room's Socket.io namespace and mirrors it into the room store.
// The handshake carries the Supabase access token; it is read on every
// (re)connect so a refreshed token is picked up automatically.
export function useRoomSocket(roomId) {
  const socketRef = useRef(null);
  const lastSent = useRef({ at: 0, x: NaN, y: NaN, z: NaN, rotationY: NaN });
  const lastPosition = useRef(null); // latest local position, sent or not
  const lastReaction = useRef(0);

  useEffect(() => {
    const { reset } = useRoom.getState();
    reset();
    const set = useRoom.setState;

    const socket = io(roomNamespace(roomId), {
      auth: (cb) => cb({ token: accessToken() }),
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on(EVENTS.ROOM_STATE, ({ selfId, players, room }) => {
      // (Re)connected: the server placed us at a fresh spawn, so send our real
      // position on the next frame even if we're standing still.
      lastSent.current = { at: 0, x: NaN, y: NaN, z: NaN, rotationY: NaN };
      remoteTransforms.clear();
      const others = {};
      let spawn = null;
      for (const p of players) {
        if (p.id === selfId) {
          spawn = transformOf(p);
          continue;
        }
        others[p.id] = { id: p.id, name: p.name, isHost: p.isHost, seatId: p.seatId ?? null };
        remoteTransforms.set(p.id, transformOf(p));
      }
      set((s) => ({
        connection: 'connected',
        error: null,
        selfId,
        // Keep the original spawn across reconnects so the local player isn't teleported.
        spawn: s.spawn ?? spawn,
        // A reconnect starts you standing again on the server.
        selfSeatId: null,
        players: others,
        status: room.status,
        sharing: room.sharing,
      }));
    });

    socket.on(EVENTS.PLAYER_JOIN, (p) => {
      if (p.id === useRoom.getState().selfId) return;
      remoteTransforms.set(p.id, transformOf(p));
      set((s) => ({ players: { ...s.players, [p.id]: { id: p.id, name: p.name, isHost: p.isHost, seatId: p.seatId ?? null } } }));
    });

    socket.on(EVENTS.PLAYER_MOVE, (m) => {
      if (remoteTransforms.has(m.id)) remoteTransforms.set(m.id, transformOf(m));
    });

    const setSeat = (id, seatId) =>
      set((s) => (s.players[id] ? { players: { ...s.players, [id]: { ...s.players[id], seatId } } } : s));
    socket.on(EVENTS.PLAYER_SIT, ({ id, seatId, x, z, rotationY }) => {
      if (remoteTransforms.has(id)) remoteTransforms.set(id, { x, y: 0, z, rotationY });
      setSeat(id, seatId);
    });
    socket.on(EVENTS.PLAYER_STAND, ({ id }) => setSeat(id, null));
    socket.on(EVENTS.PLAYER_REACT, ({ id, reaction }) => reactionBus.emit(id, reaction));

    socket.on(EVENTS.PLAYER_LEAVE, ({ id }) => {
      remoteTransforms.delete(id);
      set((s) => {
        const players = { ...s.players };
        delete players[id];
        return { players };
      });
    });

    socket.on(EVENTS.HOST_STARTED_SHARE, () => set({ sharing: true }));
    socket.on(EVENTS.HOST_STOPPED_SHARE, () => set({ sharing: false }));
    socket.on(EVENTS.ROOM_LIVE, () => set({ status: 'live' }));
    socket.on(EVENTS.ROOM_ENDED, ({ reason }) => {
      set({ connection: 'ended', endedReason: reason, status: 'ended', sharing: false });
      socket.disconnect();
    });

    socket.on('connect_error', (err) => {
      const ended = /ended/i.test(err.message);
      set({ connection: ended ? 'ended' : 'error', error: err.message, endedReason: ended ? 'host_ended' : null });
    });
    socket.on('disconnect', (reason) => {
      if (useRoom.getState().connection === 'ended') return;
      // The server only disconnects us on purpose: invite revoked, or the room
      // was opened again in another tab.
      if (reason === 'io server disconnect') {
        set({ connection: 'error', error: 'Disconnected: you may have opened this room in another tab, or your invite was removed.' });
      } else {
        set({ connection: 'reconnecting' });
      }
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      reset();
    };
  }, [roomId]);

  // Called every frame by the local player; sends at most MOVE_SEND_HZ times a
  // second, and only when something changed.
  const sendMove = useCallback((x, y, z, rotationY) => {
    lastPosition.current = { x, z };
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const now = performance.now();
    const last = lastSent.current;
    if (now - last.at < SEND_INTERVAL_MS) return;
    const moved =
      Math.abs(x - last.x) > 0.01 ||
      Math.abs(y - last.y) > 0.01 ||
      Math.abs(z - last.z) > 0.01 ||
      Math.abs(rotationY - last.rotationY) > 0.01;
    if (!moved) return;
    lastSent.current = { at: now, x, y, z, rotationY };
    socket.volatile.emit(EVENTS.PLAYER_MOVE, { x, y, z, rotationY });
  }, []);

  const announceShare = useCallback((sharing) => {
    socketRef.current?.emit(sharing ? EVENTS.HOST_STARTED_SHARE : EVENTS.HOST_STOPPED_SHARE);
    useRoom.setState({ sharing });
  }, []);

  // Ask the server for a seat; resolves { ok, error? }.
  const sit = useCallback(
    (seatId) =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) return resolve({ ok: false, error: 'Not connected' });
        // Include where we are, so the server's reach check uses our real position.
        socket.timeout(4000).emit(EVENTS.PLAYER_SIT, { seatId, ...lastPosition.current }, (err, res) => {
          if (err) return resolve({ ok: false, error: 'The server did not answer, try again' });
          if (res.ok) useRoom.setState({ selfSeatId: seatId });
          resolve(res);
        });
      }),
    [],
  );

  const stand = useCallback(() => {
    socketRef.current?.emit(EVENTS.PLAYER_STAND);
    useRoom.setState({ selfSeatId: null });
  }, []);

  // Show the reaction on our own avatar straight away and send it to everyone else.
  const react = useCallback((reaction) => {
    const now = performance.now();
    if (now - lastReaction.current < REACTION_COOLDOWN_MS) return;
    lastReaction.current = now;
    const { selfId } = useRoom.getState();
    if (selfId) reactionBus.emit(selfId, reaction);
    socketRef.current?.emit(EVENTS.PLAYER_REACT, { reaction });
  }, []);

  return { sendMove, announceShare, sit, stand, react };
}
