// Runs supabase/migrations on an in-process Postgres (PGlite) with a minimal
// stand-in for Supabase's auth schema and roles, then checks the Row Level
// Security policies by acting as different signed-in users.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');

// What Supabase provides before any project migration runs.
const SUPABASE_SHIM = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let db;
const users = {};

async function signUp(key, email, name) {
  const { rows } = await db.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [email, JSON.stringify(name ? { name } : {})],
  );
  users[key] = rows[0].id;
}

// Runs fn with queries executed as the given user (or anon when key is null),
// exactly like PostgREST does: SET ROLE + request.jwt.claims.
async function as(key, fn) {
  return db.transaction(async (tx) => {
    if (key) {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: users[key], role: 'authenticated' })]);
      await tx.query('set local role authenticated');
    } else {
      await tx.query('set local role anon');
    }
    return fn(tx);
  });
}

// Like `as`, but expects the statement to fail and returns the error message.
async function denied(key, sql, params) {
  try {
    await as(key, (tx) => tx.query(sql, params));
  } catch (err) {
    return err.message;
  }
  assert.fail(`expected "${sql}" to be rejected for ${key ?? 'anon'}`);
}

const forestId = async () => (await db.query(`select id from environments where name = 'Night Forest'`)).rows[0].id;
const islandId = async () => (await db.query(`select id from environments where name = 'Island'`)).rows[0].id;

before(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE_SHIM);
  for (const file of (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(path.join(migrationsDir, file), 'utf8'));
  }
  await signUp('alice', 'alice@example.com', 'Alice');
  await signUp('bob', 'Bob@Example.com', 'Bob');
  await signUp('eve', 'eve@example.com', '');
});

test('signup creates a profile; name falls back to the email', async () => {
  const { rows } = await db.query('select id, name, role from profiles order by name');
  assert.deepEqual(rows.map((r) => [r.name, r.role]), [['Alice', 'normal'], ['Bob', 'normal'], ['eve', 'normal']]);
});

test('anon can read nothing', async () => {
  assert.match(await denied(null, 'select * from environments'), /permission denied/);
  assert.match(await denied(null, 'select * from profiles'), /permission denied/);
  assert.match(await denied(null, `select public.list_friends()`), /permission denied/);
});

test('profiles: rename yourself, never promote yourself or rename others', async () => {
  await as('alice', (tx) => tx.query(`update profiles set name = 'Alice B' where id = $1`, [users.alice]));
  const others = await as('alice', (tx) => tx.query(`update profiles set name = 'hacked' where id = $1`, [users.bob]));
  assert.equal(others.affectedRows, 0);
  assert.match(await denied('alice', `update profiles set role = 'admin' where id = $1`, [users.alice]), /permission denied/);
  const { rows } = await db.query('select name, role from profiles where id = $1', [users.alice]);
  assert.deepEqual(rows[0], { name: 'Alice B', role: 'normal' });
});

test('friends: request by email, accept, list with emails', async () => {
  assert.match(await denied('alice', `insert into friendships (user_id, friend_id) values ($1, $2)`, [users.alice, users.bob]), /permission denied/);
  assert.match(await denied('alice', `select public.request_friend('nobody@example.com')`), /No user with that email/);
  assert.match(await denied('alice', `select public.request_friend('ALICE@example.com')`), /yourself/);

  const sent = await as('alice', (tx) => tx.query(`select public.request_friend('bob@example.com') as s`));
  assert.equal(sent.rows[0].s, 'pending');

  // The requester can't accept their own request; eve can't see it at all.
  const selfAccept = await as('alice', (tx) =>
    tx.query(`update friendships set status = 'accepted' where user_id = $1 and friend_id = $2`, [users.alice, users.bob]),
  );
  assert.equal(selfAccept.affectedRows, 0);
  assert.equal((await as('eve', (tx) => tx.query('select * from friendships'))).rows.length, 0);

  const incoming = await as('bob', (tx) => tx.query('select * from public.list_friends()'));
  assert.deepEqual(incoming.rows.map((r) => [r.name, r.email, r.status, r.direction]), [['Alice B', 'alice@example.com', 'pending', 'incoming']]);

  const accepted = await as('bob', (tx) =>
    tx.query(`update friendships set status = 'accepted' where user_id = $1 and friend_id = $2 returning status`, [users.alice, users.bob]),
  );
  assert.equal(accepted.rows[0].status, 'accepted');

  // Eve asks Alice; Alice asking Eve back accepts instead of duplicating.
  await as('eve', (tx) => tx.query(`select public.request_friend('alice@example.com')`));
  const back = await as('alice', (tx) => tx.query(`select public.request_friend('eve@example.com') as s`));
  assert.equal(back.rows[0].s, 'accepted');
  assert.equal((await db.query('select count(*)::int as n from friendships')).rows[0].n, 2);

  // Either side can unfriend.
  await as('eve', (tx) => tx.query('delete from friendships where user_id = $1 and friend_id = $2', [users.eve, users.alice]));
  assert.equal((await db.query('select count(*)::int as n from friendships')).rows[0].n, 1);
});

test('rooms: create as host (insert ... returning), not for others, not in unavailable environments', async () => {
  const forest = await forestId();
  const room = await as('alice', (tx) =>
    tx.query('insert into watch_rooms (host_user_id, environment_id) values ($1, $2) returning id, status', [users.alice, forest]),
  );
  assert.equal(room.rows[0].status, 'waiting');
  const roomId = room.rows[0].id;

  assert.match(
    await denied('alice', 'insert into watch_rooms (host_user_id, environment_id) values ($1, $2)', [users.bob, await forestId()]),
    /row-level security/,
  );
  assert.match(
    await denied('alice', 'insert into watch_rooms (host_user_id, environment_id) values ($1, $2)', [users.alice, await islandId()]),
    /row-level security/,
  );
  assert.match(
    await denied('alice', `insert into watch_rooms (host_user_id, environment_id, status) values ($1, $2, 'live')`, [users.alice, await forestId()]),
    /row-level security/,
  );
  // Status changes are server-only.
  assert.match(await denied('alice', `update watch_rooms set status = 'live' where id = $1`, [roomId]), /permission denied/);

  // Bob can't see the room until invited.
  assert.equal((await as('bob', (tx) => tx.query('select * from watch_rooms'))).rows.length, 0);
  assert.match(
    await denied('bob', 'insert into watch_room_participants (room_id, user_id) values ($1, $2)', [roomId, users.bob]),
    /row-level security/,
  );

  // Only the host invites, and only friends (Eve unfriended Alice above).
  assert.match(
    await denied('bob', 'insert into watch_room_invites (room_id, user_id) values ($1, $2)', [roomId, users.bob]),
    /row-level security/,
  );
  assert.match(
    await denied('alice', 'insert into watch_room_invites (room_id, user_id) values ($1, $2)', [roomId, users.eve]),
    /row-level security/,
  );
  await as('alice', (tx) =>
    tx.query('insert into watch_room_invites (room_id, user_id) values ($1, $2) on conflict do nothing returning *', [roomId, users.bob]),
  );

  // Now Bob sees it, with the host's name and the environment via joins.
  const seen = await as('bob', (tx) =>
    tx.query(
      `select r.id, p.name as host_name, e.name as env from watch_rooms r
       join profiles p on p.id = r.host_user_id join environments e on e.id = r.environment_id`,
    ),
  );
  assert.deepEqual(seen.rows.map((r) => [r.host_name, r.env]), [['Alice B', 'Night Forest']]);
  assert.equal((await as('bob', (tx) => tx.query('select * from watch_room_invites'))).rows.length, 1);
  assert.equal((await as('eve', (tx) => tx.query('select * from watch_rooms'))).rows.length, 0);

  // Bob records his own join (not someone else's); both can see participants.
  await as('bob', (tx) =>
    tx.query('insert into watch_room_participants (room_id, user_id) values ($1, $2) on conflict do nothing', [roomId, users.bob]),
  );
  await as('bob', (tx) =>
    tx.query('insert into watch_room_participants (room_id, user_id) values ($1, $2) on conflict do nothing', [roomId, users.bob]),
  );
  assert.match(
    await denied('bob', 'insert into watch_room_participants (room_id, user_id) values ($1, $2)', [roomId, users.alice]),
    /row-level security/,
  );
  assert.equal((await as('alice', (tx) => tx.query('select * from watch_room_participants'))).rows.length, 1);

  // Invitees can't revoke invites or delete rooms.
  assert.match(await denied('bob', 'delete from watch_room_invites where room_id = $1', [roomId]), /permission denied/);
  assert.match(await denied('alice', 'delete from watch_rooms where id = $1', [roomId]), /permission denied/);

  // Once the server ends the room, no new invites or joins.
  await db.query(`update watch_rooms set status = 'ended', ended_at = now() where id = $1`, [roomId]);
  assert.match(
    await denied('bob', 'insert into watch_room_participants (room_id, user_id) values ($1, $2)', [roomId, users.alice]),
    /row-level security/,
  );
});
