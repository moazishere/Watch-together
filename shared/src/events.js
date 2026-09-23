// Socket.io event names shared by server and client (spec: "Real-time architecture").
export const EVENTS = Object.freeze({
  // server -> joining client: full snapshot of the room on connect
  ROOM_STATE: 'room:state',
  PLAYER_JOIN: 'player:join',
  PLAYER_MOVE: 'player:move',
  PLAYER_LEAVE: 'player:leave',
  // client -> server with an ack; server -> others as { id, seatId, x, z, rotationY }
  PLAYER_SIT: 'player:sit',
  PLAYER_STAND: 'player:stand',
  // client -> server { reaction: index into REACTIONS }; server -> others { id, reaction }
  PLAYER_REACT: 'player:react',
  // client -> server { text } with an ack { ok, error? };
  // server -> everyone { id, userId, name, text, at }
  CHAT_SEND: 'chat:send',
  CHAT_MESSAGE: 'chat:message',
  HOST_STARTED_SHARE: 'room:host_started_share',
  HOST_STOPPED_SHARE: 'room:host_stopped_share',
  // waiting -> live transition (host pressed "Start session")
  ROOM_LIVE: 'room:live',
  ROOM_ENDED: 'room:ended',
});

// Client send rate for player:move (spec: ~15-20 updates/sec).
export const MOVE_SEND_HZ = 15;

// Server-side sanity limits for player:move.
export const MAX_MOVE_EVENTS_PER_SEC = 30;
export const MAX_STEP_DISTANCE = 3; // metres allowed between two consecutive updates

export const roomNamespace = (roomId) => `/room/${roomId}`;

// Emoji reactions, triggered with keys 1-5. Only the index travels over the wire.
export const REACTIONS = Object.freeze(['😂', '❤️', '😮', '👏', '🔥']);
// Server-side spam limit: at most this many reactions per player per window.
export const MAX_REACTIONS_PER_WINDOW = 6;
export const REACTION_WINDOW_MS = 3000;

// Text chat: kept in server memory only (never the database).
export const CHAT_MAX_LENGTH = 300;
export const CHAT_HISTORY = 50; // recent messages a late joiner receives
export const MAX_CHAT_PER_WINDOW = 5;
export const CHAT_WINDOW_MS = 5000;
