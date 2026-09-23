import http from 'node:http';
import { Server } from 'socket.io';
import { config } from './config.js';
import { createApp } from './app.js';
import { hub } from './realtime/roomHub.js';
import { isScreenShareConfigured } from './services/livekit.js';

const app = createApp();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.clientOrigin },
  cleanupEmptyChildNamespaces: true,
});
hub.attach(io);

server.listen(config.port, () => {
  console.log(`API + Socket.io listening on http://localhost:${config.port}`);
  if (!isScreenShareConfigured()) console.log('LIVEKIT_* not set: screen share is disabled');
});
