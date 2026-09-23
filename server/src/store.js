// Everything the server reads or writes in Supabase, behind one object so the
// realtime tests can swap in an in-memory version (see test/api.test.js).
// Simple CRUD (rooms, friends, invites) happens in the browser under RLS; the
// server only touches the data it needs for sockets, screen share and room status.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { config } from './config.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

function createSupabaseStore() {
  const admin = createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // The server never uses Supabase Realtime, but supabase-js builds its
    // client up front and Node < 22 has no native WebSocket to give it.
    realtime: { transport: WebSocket },
  });

  return {
    // Verifies a Supabase access token (locally via the project's JWKS when it
    // uses asymmetric signing keys, otherwise via the Auth server) and returns
    // the user id, or null if the token is invalid or expired.
    async verifyToken(token) {
      if (!token) return null;
      const { data, error } = await admin.auth.getClaims(token);
      if (error || !data?.claims?.sub) return null;
      return data.claims.sub;
    },

    async getProfile(userId) {
      return unwrap(await admin.from('profiles').select('id, name').eq('id', userId).maybeSingle());
    },

    async getRoom(roomId) {
      if (!isUuid(roomId)) return null;
      const row = unwrap(
        await admin
          .from('watch_rooms')
          .select('id, status, host_user_id, environment_id, host:profiles!host_user_id(name)')
          .eq('id', roomId)
          .maybeSingle(),
      );
      return row && { id: row.id, status: row.status, hostUserId: row.host_user_id, hostName: row.host?.name, environmentId: row.environment_id };
    },

    async isInvited(roomId, userId) {
      const { count, error } = await admin
        .from('watch_room_invites')
        .select('user_id', { count: 'exact', head: true })
        .eq('room_id', roomId)
        .eq('user_id', userId);
      if (error) throw error;
      return count > 0;
    },

    // Of the given room ids, the ones this user hosts or is invited to.
    async accessibleRoomIds(userId, roomIds) {
      const ids = roomIds.filter(isUuid);
      if (!ids.length) return [];
      const [hosted, invited] = await Promise.all([
        admin.from('watch_rooms').select('id').in('id', ids).eq('host_user_id', userId).then(unwrap),
        admin.from('watch_room_invites').select('room_id').in('room_id', ids).eq('user_id', userId).then(unwrap),
      ]);
      return [...new Set([...hosted.map((r) => r.id), ...invited.map((r) => r.room_id)])];
    },

    async getEnvironment(environmentId) {
      const row = unwrap(
        await admin.from('environments').select('asset_config, screen_position, walkable_bounds').eq('id', environmentId).maybeSingle(),
      );
      return row && { assetConfig: row.asset_config, screenPosition: row.screen_position, walkableBounds: row.walkable_bounds };
    },

    // waiting -> live. Returns true if this call changed the status.
    async markRoomLive(roomId) {
      const rows = unwrap(
        await admin.from('watch_rooms').update({ status: 'live' }).eq('id', roomId).eq('status', 'waiting').select('id'),
      );
      return rows.length > 0;
    },

    // -> ended. Returns true if this call changed the status.
    async markRoomEnded(roomId) {
      const rows = unwrap(
        await admin
          .from('watch_rooms')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', roomId)
          .neq('status', 'ended')
          .select('id'),
      );
      return rows.length > 0;
    },

    async deleteInvite(roomId, userId) {
      unwrap(await admin.from('watch_room_invites').delete().eq('room_id', roomId).eq('user_id', userId));
    },
  };
}

let store = null;

export function getStore() {
  store ??= createSupabaseStore();
  return store;
}

// Tests only.
export function setStore(replacement) {
  store = replacement;
}
