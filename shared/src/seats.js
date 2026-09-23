// Seats in front of the screen: curved rows of log benches, each seating a few
// people, all facing the screen. Computed from environments.screen_position so
// every environment gets seats for free; asset_config.seats can tune it:
//   "seats": { "rows": [{ "distance": 9, "benches": 3, "spread": 0.42 }], "perBench": 3 }
// Server and client both call this, so seat ids and positions always agree.

export const SEAT_HEIGHT = 0.5; // top of a log bench, metres
export const SIT_REACH = 2.5; // how close you must be to take a seat

const DEFAULT_LAYOUT = {
  rows: [
    { distance: 9, benches: 3, spread: 0.42 },
    { distance: 12.5, benches: 3, spread: 0.32 },
  ],
  perBench: 3,
  seatSpacing: 0.8,
};

// Direction the avatar must face (rotationY; avatars look down -Z at 0) to look at (tx, tz).
export function facing(x, z, tx, tz) {
  return Math.atan2(-(tx - x), -(tz - z));
}

export function seatLayout(screen, override = {}) {
  const layout = { ...DEFAULT_LAYOUT, ...override };
  const sx = screen?.x ?? 0;
  const sz = screen?.z ?? 0;
  const screenRot = screen?.rotation_y ?? 0;
  const benches = [];
  const seats = [];

  layout.rows.forEach((row, r) => {
    for (let b = 0; b < row.benches; b++) {
      // Spread benches along an arc centred on the screen's forward direction.
      const angle = screenRot + (b - (row.benches - 1) / 2) * row.spread;
      const x = sx + Math.sin(angle) * row.distance;
      const z = sz + Math.cos(angle) * row.distance;
      const rotationY = facing(x, z, sx, sz);
      const length = layout.perBench * layout.seatSpacing + 0.3;
      const bench = { id: `r${r}b${b}`, x, z, rotationY, length };
      benches.push(bench);

      // Seats lie along the bench, i.e. along the avatar's left-right axis.
      const rightX = Math.cos(rotationY);
      const rightZ = -Math.sin(rotationY);
      for (let s = 0; s < layout.perBench; s++) {
        const offset = (s - (layout.perBench - 1) / 2) * layout.seatSpacing;
        const seatX = x + rightX * offset;
        const seatZ = z + rightZ * offset;
        seats.push({ id: `${bench.id}s${s}`, bench: bench.id, x: seatX, z: seatZ, rotationY: facing(seatX, seatZ, sx, sz) });
      }
    }
  });

  return { benches, seats };
}

// The closest seat within reach of (x, z) that isn't in `taken`, or null.
export function nearestFreeSeat(seats, x, z, taken = new Set(), reach = SIT_REACH) {
  let best = null;
  let bestDist = reach;
  for (const seat of seats) {
    if (taken.has(seat.id)) continue;
    const d = Math.hypot(seat.x - x, seat.z - z);
    if (d <= bestDist) {
      bestDist = d;
      best = seat;
    }
  }
  return best;
}
