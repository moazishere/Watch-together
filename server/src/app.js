import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler, notFound } from './lib/http.js';
import roomRoutes from './routes/rooms.js';
import { isScreenShareConfigured } from './services/livekit.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Public feature flags for the client.
  app.get('/api/config', (_req, res) => res.json({ screenShare: isScreenShareConfigured(), voice: isScreenShareConfigured() }));
  app.use('/api/rooms', roomRoutes);

  app.use('/api', (_req, _res, next) => next(notFound()));

  // In production, serve the built client (npm run build) from the same origin.
  const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
