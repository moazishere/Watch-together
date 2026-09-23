import { useMemo } from 'react';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { radialFadeTexture } from '../../../lib/textures.js';
import { Grass, Rocks, Trees } from './Trees.jsx';
import { Fireflies, Meteors, Moon } from './Sky.jsx';

// Night Forest: a moonlit clearing ringed by pines, under stars and meteors.
// Every tunable comes from environments.asset_config (see 002_seed_environments.sql).
export default function NightForest({ config }) {
  const {
    background = '#04060f',
    fog = { color: '#060a18', near: 14, far: 75 },
    ambientLight = { color: '#4a5a8f', intensity: 0.45 },
    moonLight = { color: '#a8bcff', intensity: 1.1, position: [-35, 45, -30] },
    moon = {},
    ground = { color: '#0b1710', clearingColor: '#16291c', clearingRadius: 17 },
    stars = { count: 6000 },
    meteors = { count: 6 },
    fireflies = { count: 80 },
    trees = { count: 250, minRadius: 21, maxRadius: 80, seed: 1 },
  } = config;

  const clearing = useMemo(() => radialFadeTexture(ground.clearingColor), [ground.clearingColor]);
  const r = ground.clearingRadius;

  return (
    <>
      <color attach="background" args={[background]} />
      <fog attach="fog" args={[fog.color, fog.near, fog.far]} />

      <ambientLight color={ambientLight.color} intensity={ambientLight.intensity} />
      <hemisphereLight args={['#4a60a8', '#0c1810', 0.6]} />
      <directionalLight position={moonLight.position} color={moonLight.color} intensity={moonLight.intensity} />

      <Stars radius={160} depth={60} count={stars.count} factor={5} saturation={0} fade speed={0.5} />
      <Moon position={moon.position} radius={moon.radius} />
      <Meteors count={meteors.count} />

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[260, 48]} />
        <meshStandardMaterial color={ground.color} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <planeGeometry args={[r * 2.6, r * 2.6]} />
        <meshStandardMaterial map={clearing} transparent depthWrite={false} roughness={1} side={THREE.FrontSide} />
      </mesh>

      <Trees count={trees.count} minRadius={trees.minRadius} maxRadius={trees.maxRadius} seed={trees.seed} />
      <Rocks innerRadius={r - 0.5} outerRadius={r + 4} seed={trees.seed + 1} />
      <Grass radius={r} seed={trees.seed + 2} />
      <Fireflies count={fireflies.count} innerRadius={8} outerRadius={r + 14} />
    </>
  );
}
