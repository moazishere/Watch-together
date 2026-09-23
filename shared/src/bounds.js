// Walkable-bounds geometry on the XZ plane, used by the client for movement and
// by the server to validate player:move. Two shapes are supported, matching
// environments.walkable_bounds:
//   { "type": "box", "minX": -10, "maxX": 10, "minZ": -10, "maxZ": 10 }
//   { "type": "polygon", "points": [[x, z], [x, z], ...] }

export function isInsideBounds(bounds, x, z) {
  if (!bounds) return true;
  if (bounds.type === 'box') {
    return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
  }
  if (bounds.type === 'polygon') {
    return pointInPolygon(bounds.points, x, z);
  }
  throw new Error(`Unknown walkable_bounds type: ${bounds.type}`);
}

function pointInPolygon(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    const crosses = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Moves from (fromX, fromZ) towards (toX, toZ) without leaving the bounds.
// If the full step is blocked, try each axis on its own so the player slides
// along the edge instead of sticking to it.
export function constrainMove(bounds, fromX, fromZ, toX, toZ) {
  if (isInsideBounds(bounds, toX, toZ)) return { x: toX, z: toZ };
  if (isInsideBounds(bounds, toX, fromZ)) return { x: toX, z: fromZ };
  if (isInsideBounds(bounds, fromX, toZ)) return { x: fromX, z: toZ };
  if (isInsideBounds(bounds, fromX, fromZ)) return { x: fromX, z: fromZ };
  return nearestInside(bounds, toX, toZ);
}

// Closest point inside the bounds to (x, z).
export function nearestInside(bounds, x, z) {
  if (!bounds || isInsideBounds(bounds, x, z)) return { x, z };
  if (bounds.type === 'box') {
    return {
      x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
      z: Math.min(bounds.maxZ, Math.max(bounds.minZ, z)),
    };
  }
  const { points } = bounds;
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[(i + 1) % points.length];
    const p = closestPointOnSegment(ax, az, bx, bz, x, z);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  // Nudge slightly towards the centroid so the result is strictly inside.
  const c = centroid(points);
  return { x: best.x + (c.x - best.x) * 0.001, z: best.z + (c.z - best.z) * 0.001 };
}

function closestPointOnSegment(ax, az, bx, bz, px, pz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  return { x: ax + t * dx, z: az + t * dz };
}

function centroid(points) {
  let x = 0;
  let z = 0;
  for (const [px, pz] of points) {
    x += px;
    z += pz;
  }
  return { x: x / points.length, z: z / points.length };
}

// A spawn point: the environment's preferred spawn if valid, jittered so
// players joining at the same time don't stack on top of each other.
export function pickSpawnPoint(bounds, preferred = { x: 0, z: 0 }, random = Math.random) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.5 + random() * 2.5;
    const x = preferred.x + Math.cos(angle) * radius;
    const z = preferred.z + Math.sin(angle) * radius;
    if (isInsideBounds(bounds, x, z)) return { x, z };
  }
  return nearestInside(bounds, preferred.x, preferred.z);
}
