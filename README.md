# Watch Together: 3D World (Phase 1)

Friends meet in a 3D **Night Forest** in the browser, walk around as simple avatars, and watch the host's
**live screen share** on a giant in-world screen. There's no video storage: the host's laptop screen is
broadcast over WebRTC through [LiveKit](https://livekit.io), so everyone sees the same moment.

```
supabase/  migrations: schema, Row Level Security policies, environment seed
shared/    bounds maths + socket event names, used by both sides
server/    Express + Socket.io: realtime rooms, session start/end, LiveKit tokens
client/    Vite + React + React Three Fiber (lobby, 3D room, screen share)
```

## Who does what

| | Supabase | Express + Socket.io |
| --- | --- | --- |
| Auth | Email/password sign-up and login (Supabase Auth). `profiles` holds name and role. | Verifies the Supabase access token on API calls and socket handshakes. |
| Data | Environments, rooms, invites, participants, friendships. The browser reads and writes these **directly**, limited by RLS. | Only what has a side effect: start or end a session, LiveKit call tokens, and revoking an invite (which also kicks the user). |
| Realtime | Not used. | Everything high-frequency: `player:move`, `player:join/leave`, share events, `room:live/ended`. Kept in memory; **never touches the database**. |

## Setup

Needs Node 20.19+ and a Supabase project, either hosted
([supabase.com](https://supabase.com)) or local (`npx supabase start`, which needs Docker).

```bash
npm install
```

**1. Create the tables.** Run the three files in `supabase/migrations/` in order: schema, RLS, seed.
Either paste them into the dashboard's **SQL Editor**, or use the CLI:

```bash
npx supabase init
```

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
```

```bash
npm run db:push
```

**2. Configure.** Copy `.env.example` to `.env` and fill in the project URL and keys
(Project Settings → API Keys):

- `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` go to the browser.
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are for the server only. The secret key bypasses RLS.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` are optional and turn on screen share. Create a free
  project at [cloud.livekit.io](https://cloud.livekit.io) (no card needed), then go to Settings → API Keys. The URL is the
  project's `wss://…livekit.cloud` address.

Hosted projects have **Confirm email** on by default. New users then have to click the emailed link
before they can log in, and the sign-up page tells them so. For quick local testing, switch it off under
Authentication → Sign In / Providers → Email.

**3. Run.**

```bash
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/socket.io` to the server on port 4000.

## Trying it with two people

Sessions are stored per browser, so for the second person on the same machine use another browser or a
private window.

1. Both sign up. One adds the other by email under **Friends**, and the other accepts.
2. The host picks **Night Forest** → **Create room**. In the room, open **Invite friends** → **Invite**.
3. The friend sees the room in their lobby → **Join**. Both avatars are visible and move live.
4. The host presses **Start session** (the room goes `live` and everyone joins the LiveKit call), then
   **Share screen**. Pick a tab or window, and tick "share audio" so the movie has sound.
5. **End room** closes it for everyone. If the host just disconnects, the room ends automatically
   after 60 s (`HOST_GRACE_MS`).

Controls: click the scene to capture the mouse, then **WASD** to move, **Shift** to run, **Space** to jump,
mouse to look, scroll to zoom (all the way in is first person), **Esc** to release the mouse. Walk up to a
log bench in front of the screen and press **E** to sit. The camera glides into a movie view. Press **E**
again, or move, to stand up. Press **C** for cinema mode: the camera glides to a centered view of the screen and
all menus hide. Press **C** (or **Esc**) to come back. Press **1–5** (or click the bar at the bottom) to react
with 😂 ❤️ 😮 👏 🔥. The emoji floats above your head for everyone, and in cinema mode reactions also
rise up the side of the screen.

**Voice chat:** your mic starts muted. Press **V** (or the mic button) to turn it on, or hold **T** to
talk while muted. Voices are **spatial**: they come from where each friend's character stands, louder
up close and quieter across the clearing. A 🎙️ shows over whoever is talking, and the movie's sound
dips a little while friends talk. Voice works as soon as you enter a room, before the movie starts.
Use headphones so the movie doesn't echo into your mic.

**Text chat:** press **Enter** to type, **Enter** again to send, and **Esc** to cancel. Messages show in
the panel at the bottom left and as a speech bubble over the sender for a few seconds. In cinema mode,
new messages appear briefly over the picture. People who join later see the last 50 messages.

`/preview` shows an environment with no networking: fly-around camera, single-player walk mode,
walkable-bounds outline, and a test pattern that checks the screen's video texture without LiveKit.

For friends on other networks, deploy it (or tunnel it) over **HTTPS**. Browsers only allow
`getDisplayMedia` (screen share) on secure origins or localhost. In production, `npm run build` and
then `npm start -w server` serves the built client and the API from one port.

## Tests

```bash
npm test
```

No Supabase project is needed:

- **`server/test/rls.test.js`** runs the real migration files on an in-process Postgres (PGlite), with a
  stand-in for Supabase's `auth` schema and roles. It checks every policy by acting as different users:
  anon sees nothing, no self-promotion to admin, friend requests and accepts, host-only invites to
  friends, room creation with `insert … returning`, and no joins after a room ends.
- **`server/test/livekit.test.js`** checks the permissions in the call tokens: everyone can publish a
  microphone, only the host can share a screen, and nobody can publish a camera.
- **`server/test/api.test.js`** runs the Express and Socket.io layer against an in-memory store. It
  covers auth, room access, presence, start/end, invite revocation that kicks the user, movement relay
  and bounds enforcement, host-only share events, and the host-left grace period.
- **`shared/test`** holds the walkable-bounds maths.

## How it maps to the spec

| Spec | Where |
| --- | --- |
| Data model | `supabase/migrations/20260923000000_schema.sql`. `users` is Supabase's `auth.users` plus `profiles` (name, role), created by a trigger on sign-up. It also adds `watch_room_invites` (see below). |
| Access rules | `supabase/migrations/20260923000001_rls.sql` |
| Environments (pluggable) | Rows in `environments`. `asset_config.kind` picks the scene component in `client/src/world/environments/index.js`. The Island is seeded with `available: false`. |
| Browser data calls | `client/src/lib/data.js` |
| Socket events | Namespace `/room/:roomId`, `server/src/realtime/roomHub.js`, names in `shared/src/events.js` |
| Move rate | Client sends at most 15 Hz, and only when something changed. The server rate-limits at 30/s, caps each step at 3 m, and clamps to `walkable_bounds`. |
| WebRTC | `server/src/services/livekit.js` signs a LiveKit token per user for the room `wt-<roomId>`. Everyone can subscribe and publish a microphone, and only the host can also publish screen share and screen audio. Nobody can publish a camera. LiveKit creates the room on first join, and the server deletes it when the watch room ends. `client/src/world/useLiveKitRoom.js` holds the connection, `useScreenShare.js` turns the host's screen into a `VideoTexture`, and `useVoiceChat.js` + `voiceAudio.js` play each voice through a Web Audio HRTF panner at that player's head (`SpatialVoice.jsx` moves them every frame). |

### Decisions beyond the spec

- **`watch_room_invites` table.** Step 6 needs to record who was invited, and the spec's tables have
  nowhere to put that. Only the host and invited friends can see a room, join it, or open its socket.
- **Friend requests by email go through `request_friend()`**, and the friends list through
  `list_friends()`. Emails live in `auth.users`, which the browser can't read. These functions expose
  only your own friends' emails.
- **Room status is server-only.** RLS lets the browser create `waiting` rooms but not change status,
  because starting and ending fan out over Socket.io and touch the LiveKit call.
- **Extra socket events.** `room:state` is the snapshot sent to a joining client, including whether a
  share is already running. `room:live` is the waiting → live transition.
- **Screen audio is included**, because a movie needs sound. The host shares tab or system audio, and viewers get a
  volume slider.
- **Voice chat arrived early** (the spec had mic for Phase 2). It uses the same LiveKit call, connected as
  soon as you enter a room. Audio is spatial, using positions we already sync over Socket.io, so there's
  no extra traffic. Mics start muted.
- **Host grace period.** A host refresh doesn't kill the room. It ends only if they stay gone for 60 s.
- **One tab per user per room.** Opening the room again in another tab takes over the avatar.
- **Seats.** `shared/src/seats.js` lays out curved rows of log benches from the screen position, 18 seats
  by default, tunable per environment with `asset_config.seats`. The server and client compute the same
  layout. The server decides who sits where: one person per seat, you must be within 2.5 m, moves are
  ignored while seated, and the seat is freed when you stand, leave or open another tab. Seat state
  travels with `player:sit` / `player:stand` and the `room:state` snapshot, and never touches the
  database. The character has no sitting animation, so `Avatar.jsx` bends the legs on top of Idle.
- **Reactions** travel as `player:react` with just an index into `REACTIONS` (`shared/src/events.js`).
  The server relays them to everyone else, at most 6 per player every 3 s, and never stores them. The
  sender shows its own reaction immediately without waiting for the server.
- **Chat** goes over Socket.io (`chat:send` → `chat:message`) and is never written to the database. The
  server keeps the last 50 messages per room in memory for late joiners (they're gone when the room
  ends or the server restarts). Messages are cleaned (control characters removed, 300 characters max),
  rate-limited to 5 per 5 s, and rendered as plain text, so HTML in a message is shown, not run.
- **Rigged character instead of the spec's primitive avatar.** `client/public/models/Soldier.glb` comes
  from the three.js examples (a Mixamo character with Idle / Walk / Run clips). Everyone uses the same
  model and is told apart by a colored ring and name tag. The animation follows how fast each avatar
  actually moves (`client/src/world/Avatar.jsx`), so remote players animate correctly without any extra
  network data. Mixamo assets can be used in projects but not redistributed as standalone assets.
  Swap in your own `.glb` (same Idle/Walk/Run clip names, facing −Z) to change the look.
