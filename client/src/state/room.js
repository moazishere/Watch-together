import { create } from 'zustand';

// Latest known transform of each remote player, written by the socket at up to
// ~15 Hz and read every frame by the avatars. Kept outside React state so
// movement never triggers re-renders.
export const remoteTransforms = new Map();

const initialState = {
  connection: 'connecting', // connecting | connected | reconnecting | error | ended
  error: null,
  endedReason: null,
  selfId: null,
  spawn: null, // { x, y, z, rotationY } assigned by the server
  players: {}, // remote players: id -> { id, name, isHost, seatId }
  selfSeatId: null, // the seat you're sitting on, if any
  speaking: {}, // identity (user id) -> true while their voice is active, you included
  status: 'waiting', // watch_rooms.status
  sharing: false, // host is currently screen sharing
};

export const useRoom = create((set) => ({
  ...initialState,
  reset() {
    remoteTransforms.clear();
    set(initialState);
  },
}));
