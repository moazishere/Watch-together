import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.API_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 4000}`;

// The dev server proxies the API and Socket.io, so the client always talks to
// its own origin and no API URL has to be configured in the browser.
export default defineConfig({
  plugins: [react()],
  // Read the repo-root .env (shared with the server). Only VITE_* values reach the browser.
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/socket.io': { target: API, ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          livekit: ['livekit-client'],
        },
      },
    },
  },
});
