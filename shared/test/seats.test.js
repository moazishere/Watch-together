import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seatLayout, nearestFreeSeat, facing } from '../src/seats.js';
import { isInsideBounds } from '../src/bounds.js';

// The seeded Night Forest.
const seed = readFileSync(new URL('../../supabase/migrations/20260923000002_seed_environments.sql', import.meta.url), 'utf8');
const [, , screenJson, boundsJson] = seed.match(/'Night Forest',\s*'([\s\S]*?)'::jsonb,\s*'([\s\S]*?)'::jsonb,\s*'([\s\S]*?)'::jsonb/);
const screen = JSON.parse(screenJson);
const bounds = JSON.parse(boundsJson);

test('default layout: 18 unique seats on 6 benches', () => {
  const { benches, seats } = seatLayout(screen);
  assert.equal(benches.length, 6);
  assert.equal(seats.length, 18);
  assert.equal(new Set(seats.map((s) => s.id)).size, 18);
});

test('every seat is inside the walkable clearing and faces the screen', () => {
  for (const seat of seatLayout(screen).seats) {
    assert.ok(isInsideBounds(bounds, seat.x, seat.z), `${seat.id} outside bounds`);
    // Looking direction (-sin r, -cos r) points at the screen.
    const lookX = -Math.sin(seat.rotationY);
    const lookZ = -Math.cos(seat.rotationY);
    const toX = screen.x - seat.x;
    const toZ = screen.z - seat.z;
    const cos = (lookX * toX + lookZ * toZ) / Math.hypot(toX, toZ);
    assert.ok(cos > 0.999, `${seat.id} does not face the screen`);
  }
});

test('seats on a bench are evenly spaced and do not overlap other benches', () => {
  const { seats } = seatLayout(screen);
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      assert.ok(Math.hypot(seats[i].x - seats[j].x, seats[i].z - seats[j].z) >= 0.75, `${seats[i].id} vs ${seats[j].id}`);
    }
  }
});

test('asset_config.seats overrides the layout', () => {
  const { seats } = seatLayout(screen, { rows: [{ distance: 8, benches: 2, spread: 0.5 }], perBench: 2 });
  assert.equal(seats.length, 4);
});

test('nearestFreeSeat respects reach and taken seats', () => {
  const { seats } = seatLayout(screen);
  const target = seats[4];
  assert.equal(nearestFreeSeat(seats, target.x + 0.1, target.z)?.id, target.id);
  assert.notEqual(nearestFreeSeat(seats, target.x + 0.1, target.z, new Set([target.id]))?.id, target.id);
  assert.equal(nearestFreeSeat(seats, 100, 100), null);
  assert.ok(Math.abs(facing(0, 0, 0, -10)) < 1e-12, 'looking down -Z is rotation 0');
});
