// Screen-share tokens: everyone can watch, only the host can publish, and
// only their screen (no mic/camera in Phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SECRET_KEY ??= 'test';
process.env.LIVEKIT_URL = 'wss://example.livekit.cloud';
process.env.LIVEKIT_API_KEY = 'APItestkey';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';

const { createCallToken, liveKitRoomName, isScreenShareConfigured } = await import('../src/services/livekit.js');

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const roomId = '2f1a7765-8398-44b3-b55d-868f0efa51f0';

test('configured from LIVEKIT_* env vars', () => {
  assert.equal(isScreenShareConfigured(), true);
});

test('host token can publish mic and screen share (no camera)', async () => {
  const { url, token } = await createCallToken({ watchRoomId: roomId, user: { id: 'host-id', name: 'Host' }, isHost: true });
  assert.equal(url, 'wss://example.livekit.cloud');
  const c = claims(token);
  assert.equal(c.sub, 'host-id');
  assert.equal(c.name, 'Host');
  assert.equal(c.iss, 'APItestkey');
  assert.equal(c.video.room, liveKitRoomName(roomId));
  assert.equal(c.video.roomJoin, true);
  assert.equal(c.video.canPublish, true);
  assert.deepEqual(c.video.canPublishSources, ['microphone', 'screen_share', 'screen_share_audio']);
  assert.ok(c.exp - c.nbf <= 6 * 3600 + 60);
});

test('viewer token can listen and talk, but not share a screen', async () => {
  const { token } = await createCallToken({ watchRoomId: roomId, user: { id: 'guest-id', name: 'Guest' }, isHost: false });
  const c = claims(token);
  assert.equal(c.video.canSubscribe, true);
  assert.equal(c.video.canPublish, true);
  assert.deepEqual(c.video.canPublishSources, ['microphone']);
  assert.equal(c.video.canPublishData, false);
});
