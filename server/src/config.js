function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see .env.example)`);
  return value;
}

export const config = {
  // In `npm run dev` the API always listens on SERVER_PORT (default 4000), which
  // the Vite dev server proxies to; tools that launch dev servers often set PORT
  // for the web page instead. In production, hosts usually provide PORT.
  port: Number(
    process.env.SERVER_PORT ?? (process.env.npm_lifecycle_event === 'dev' ? 4000 : (process.env.PORT ?? 4000)),
  ),
  // The server talks to Supabase with the secret (service_role) key, which
  // bypasses Row Level Security. Never expose it to the browser.
  supabaseUrl: required('SUPABASE_URL'),
  supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',
  // LiveKit (screen share). All three are needed; without them screen share is off.
  livekit:
    process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET
      ? { url: process.env.LIVEKIT_URL, apiKey: process.env.LIVEKIT_API_KEY, apiSecret: process.env.LIVEKIT_API_SECRET }
      : null,
  // How long a room survives the host disconnecting (e.g. a page refresh)
  // before it is ended automatically.
  hostGraceMs: Number(process.env.HOST_GRACE_MS ?? 60_000),
};
