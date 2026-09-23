import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

export default function WorldCanvas({ children, camera, onCreated }) {
  return (
    <Canvas
      className="world-canvas"
      dpr={[1, 2]}
      camera={{ fov: 60, near: 0.1, far: 500, position: [0, 3, 12], ...camera }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onCreated={onCreated}
    >
      {children}
    </Canvas>
  );
}
