-- Night Forest: the Phase 1 environment.
-- asset_config.kind picks the scene component on the client; the remaining keys
-- tune that scene. The screen faces +Z from the north edge of the clearing.
INSERT INTO environments (name, asset_config, screen_position, walkable_bounds)
VALUES (
  'Night Forest',
  '{
    "kind": "night_forest",
    "available": true,
    "background": "#04060f",
    "fog": { "color": "#060a18", "near": 14, "far": 75 },
    "ambientLight": { "color": "#5b6ca8", "intensity": 0.8 },
    "moonLight": { "color": "#b4c6ff", "intensity": 1.8, "position": [-35, 45, -30] },
    "moon": { "position": [-60, 55, -90], "radius": 5 },
    "ground": { "color": "#0e1d14", "clearingColor": "#24442f", "clearingRadius": 17 },
    "stars": { "count": 7000 },
    "meteors": { "count": 7 },
    "fireflies": { "count": 90 },
    "trees": { "count": 320, "minRadius": 21, "maxRadius": 85, "seed": 1337 },
    "spawn": { "x": 0, "z": 7 }
  }'::jsonb,
  '{ "x": 0, "y": 4.4, "z": -14, "rotation_y": 0, "width": 12.8, "height": 7.2 }'::jsonb,
  '{
    "type": "polygon",
    "points": [[-11, -9], [11, -9], [15, -2], [14, 8], [7, 14], [-7, 14], [-14, 8], [-15, -2]]
  }'::jsonb
);

-- Island: schema-ready for Phase 2, not rendered yet (available = false).
INSERT INTO environments (name, asset_config, screen_position, walkable_bounds)
VALUES (
  'Island',
  '{
    "kind": "island",
    "available": false,
    "background": "#1c2b4a",
    "spawn": { "x": 0, "z": 6 }
  }'::jsonb,
  '{ "x": 0, "y": 4, "z": -12, "rotation_y": 0, "width": 12.8, "height": 7.2 }'::jsonb,
  '{ "type": "box", "minX": -12, "maxX": 12, "minZ": -8, "maxZ": 12 }'::jsonb
);
