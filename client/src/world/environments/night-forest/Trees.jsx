import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mulberry32 } from '../../../lib/random.js';

const TIERS = 3;
const FOLIAGE_COLORS = ['#1b3a29', '#214632', '#27503a', '#1e4230', '#2d5a40'];

// Low-poly pines built from cones and cylinders, drawn as instanced meshes
// (one draw call per part, whatever the tree count).
function layoutTrees({ count, minRadius, maxRadius, seed }) {
  const random = mulberry32(seed);
  const trees = [];
  let attempts = 0;
  while (trees.length < count && attempts < count * 30) {
    attempts++;
    const angle = random() * Math.PI * 2;
    // Bias towards the inner edge so the clearing is framed by a dense tree line.
    const r = minRadius + (maxRadius - minRadius) * Math.pow(random(), 1.4);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const size = 0.75 + random() * 0.6;
    const minGap = 2.2 * size;
    if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < minGap * minGap)) continue;
    trees.push({ x, z, size, height: (6 + random() * 5) * size, rot: random() * Math.PI, tint: random() });
  }
  return trees;
}

export function Trees({ count = 250, minRadius = 20, maxRadius = 80, seed = 1 }) {
  const trees = useMemo(() => layoutTrees({ count, minRadius, maxRadius, seed }), [count, minRadius, maxRadius, seed]);
  const trunkRef = useRef();
  const tierRefs = useRef([]);

  const geometries = useMemo(
    () => ({
      trunk: new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0),
      cone: new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
    }),
    [],
  );
  const materials = useMemo(
    () => ({
      trunk: new THREE.MeshStandardMaterial({ color: '#3a2a1f', roughness: 1, flatShading: true }),
      foliage: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }),
    }),
    [],
  );

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);

    trees.forEach((t, i) => {
      q.setFromAxisAngle(up, t.rot);
      const trunkHeight = t.height * 0.28;
      const trunkRadius = 0.22 * t.size;
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(trunkRadius, trunkHeight, trunkRadius));
      trunkRef.current.setMatrixAt(i, m);

      for (let tier = 0; tier < TIERS; tier++) {
        const radius = (2.3 - tier * 0.6) * t.size;
        const coneHeight = t.height * (0.46 - tier * 0.06);
        const y = trunkHeight * 0.75 + tier * t.height * 0.2;
        m.compose(new THREE.Vector3(t.x, y, t.z), q, new THREE.Vector3(radius, coneHeight, radius));
        const mesh = tierRefs.current[tier];
        mesh.setMatrixAt(i, m);
        color.set(FOLIAGE_COLORS[Math.floor(t.tint * FOLIAGE_COLORS.length)]).offsetHSL(0, 0, tier * 0.02);
        mesh.setColorAt(i, color);
      }
    });

    trunkRef.current.instanceMatrix.needsUpdate = true;
    trunkRef.current.computeBoundingSphere();
    tierRefs.current.forEach((mesh) => {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [trees]);

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[geometries.trunk, materials.trunk, trees.length]} />
      {Array.from({ length: TIERS }, (_, tier) => (
        <instancedMesh
          key={tier}
          ref={(el) => (tierRefs.current[tier] = el)}
          args={[geometries.cone, materials.foliage, trees.length]}
        />
      ))}
    </group>
  );
}

// Scattered boulders along the edge of the clearing.
export function Rocks({ count = 26, innerRadius = 16, outerRadius = 21, seed = 7 }) {
  const ref = useRef();
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a5266', roughness: 1, flatShading: true }),
    [],
  );

  useLayoutEffect(() => {
    const random = mulberry32(seed);
    const m = new THREE.Matrix4();
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const r = innerRadius + random() * (outerRadius - innerRadius);
      const s = 0.3 + random() * 0.9;
      e.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(Math.cos(angle) * r, s * 0.35, Math.sin(angle) * r),
        q,
        new THREE.Vector3(s, s * (0.6 + random() * 0.4), s),
      );
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [count, innerRadius, outerRadius, seed]);

  return <instancedMesh ref={ref} args={[geometry, material, count]} />;
}

// Short grass tufts scattered over the clearing.
export function Grass({ count = 500, radius = 17, seed = 3 }) {
  const ref = useRef();
  const geometry = useMemo(() => new THREE.ConeGeometry(0.08, 1, 3).translate(0, 0.5, 0), []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f5a3a', roughness: 1 }), []);

  useLayoutEffect(() => {
    const random = mulberry32(seed);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      e.set((random() - 0.5) * 0.5, random() * Math.PI, (random() - 0.5) * 0.5);
      q.setFromEuler(e);
      const h = 0.15 + random() * 0.35;
      m.compose(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r), q, new THREE.Vector3(1, h, 1));
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
    ref.current.computeBoundingSphere();
  }, [count, radius, seed]);

  return <instancedMesh ref={ref} args={[geometry, material, count]} />;
}
