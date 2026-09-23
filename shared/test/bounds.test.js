import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInsideBounds, constrainMove, nearestInside, pickSpawnPoint } from '../src/bounds.js';

const box = { type: 'box', minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
const square = { type: 'polygon', points: [[-5, -5], [5, -5], [5, 5], [-5, 5]] };
const triangle = { type: 'polygon', points: [[0, 10], [10, -10], [-10, -10]] };

test('isInsideBounds handles box and polygon', () => {
  assert.equal(isInsideBounds(box, 0, 0), true);
  assert.equal(isInsideBounds(box, 6, 0), false);
  assert.equal(isInsideBounds(square, 4.9, -4.9), true);
  assert.equal(isInsideBounds(square, 0, 5.1), false);
  assert.equal(isInsideBounds(triangle, 0, 0), true);
  assert.equal(isInsideBounds(triangle, 8, 8), false);
});

test('constrainMove allows moves inside and slides along edges', () => {
  assert.deepEqual(constrainMove(box, 0, 0, 1, 1), { x: 1, z: 1 });
  // Diagonal into the right wall keeps the Z component.
  assert.deepEqual(constrainMove(box, 4.5, 0, 5.5, 1), { x: 4.5, z: 1 });
  // Straight into a corner does not move.
  assert.deepEqual(constrainMove(square, 4.9, 4.9, 5.5, 5.5), { x: 4.9, z: 4.9 });
});

test('nearestInside pulls outside points back into the shape', () => {
  const p = nearestInside(triangle, 20, 20);
  assert.equal(isInsideBounds(triangle, p.x, p.z), true);
  assert.deepEqual(nearestInside(box, 9, -9), { x: 5, z: -5 });
});

test('pickSpawnPoint always returns an inside point', () => {
  for (let i = 0; i < 100; i++) {
    const p = pickSpawnPoint(triangle, { x: 0, z: -9.5 });
    assert.equal(isInsideBounds(triangle, p.x, p.z), true);
  }
});
