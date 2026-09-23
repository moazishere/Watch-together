// Screen share over LiveKit (https://docs.livekit.io). Each watch room maps to
// one LiveKit room named after it. LiveKit creates rooms on first join, so the
// server only signs access tokens and deletes the room when it ends.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config } from '../config.js';
import { HttpError } from '../lib/http.js';

const TOKEN_TTL = '6h';

export const isScreenShareConfigured = () => Boolean(config.livekit);

export const liveKitRoomName = (watchRoomId) => `wt-${watchRoomId}`;

function requireLiveKit() {
  if (!config.livekit) {
    throw new HttpError(503, 'Screen share is not configured on this server (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET)');
  }
  return config.livekit;
}

// Everyone can listen and talk (microphone); only the host may also share
// their screen (video + audio). No cameras.
export async function createCallToken({ watchRoomId, user, isHost }) {
  const { url, apiKey, apiSecret } = requireLiveKit();
  const token = new AccessToken(apiKey, apiSecret, { identity: user.id, name: user.name, ttl: TOKEN_TTL });
  token.addGrant({
    room: liveKitRoomName(watchRoomId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: true,
    canPublishSources: isHost
      ? [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
      : [TrackSource.MICROPHONE],
    canPublishData: false,
  });
  return { url, token: await token.toJwt() };
}

// Disconnects everyone from the LiveKit room. Missing rooms are fine.
export async function deleteLiveKitRoom(watchRoomId) {
  if (!config.livekit) return;
  const { url, apiKey, apiSecret } = config.livekit;
  const client = new RoomServiceClient(url.replace(/^ws/, 'http'), apiKey, apiSecret);
  try {
    await client.deleteRoom(liveKitRoomName(watchRoomId));
  } catch (err) {
    // Nobody ever joined the call, so LiveKit never created the room.
    if (err?.status !== 404 && err?.code !== 'not_found') throw err;
  }
}
