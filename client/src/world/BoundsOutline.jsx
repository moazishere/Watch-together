import { useMemo } from 'react';
import * as THREE from 'three';

// Debug outline of an environment's walkable_bounds, drawn just above the ground.
export default function BoundsOutline({ bounds, color = '#7aa2ff' }) {
  const geometry = useMemo(() => {
    const points =
      bounds.type === 'box'
        ? [
            [bounds.minX, bounds.minZ],
            [bounds.maxX, bounds.minZ],
            [bounds.maxX, bounds.maxZ],
            [bounds.minX, bounds.maxZ],
          ]
        : bounds.points;
    return new THREE.BufferGeometry().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, 0.06, z)));
  }, [bounds]);

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color={color} transparent opacity={0.8} fog={false} />
    </lineLoop>
  );
}
