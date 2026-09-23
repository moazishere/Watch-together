// The real Supabase store must be constructible on every supported Node
// version (supabase-js needs a WebSocket implementation on Node < 22).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://supabase.invalid';
process.env.SUPABASE_SECRET_KEY ??= 'test';

const { getStore } = await import('../src/store.js');

test('the Supabase store can be created', () => {
  const store = getStore();
  assert.equal(typeof store.verifyToken, 'function');
});
