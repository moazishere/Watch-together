import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { glowTexture } from '../../../lib/textures.js';

export function Moon({ position = [-60, 55, -90], radius = 5 }) {
  const glow = useMemo(() => glowTexture(128), []);
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[radius, 32, 16]} />
        <meshBasicMaterial color="#e9eeff" fog={false} toneMapped={false} />
      </mesh>
      <sprite scale={[radius * 7, radius * 7, 1]}>
        <spriteMaterial
          map={glow}
          color="#8fa6ff"
          transparent
          opacity={0.45}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>
    </group>
  );
}

// Shooting stars: thin additive streaks that cross the sky every few seconds.
export function Meteors({ count = 6 }) {
  const group = useRef();
  const meteors = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        life: 0,
        duration: 1,
        wait: Math.random() * 6,
      })),
    [count],
  );
  const geometry = useMemo(() => {
    // A long thin cone: the wide base at the origin is the meteor head, the
    // tip trails 14 units behind along +Y.
    const g = new THREE.ConeGeometry(0.2, 14, 6, 1, true);
    g.translate(0, 7, 0);
    return g;
  }, []);

  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const dir = useMemo(() => new THREE.Vector3(), []);

  function respawn(m) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 60;
    m.position.set(Math.cos(angle) * dist, 55 + Math.random() * 35, Math.sin(angle) * dist);
    // Travel roughly tangentially and downwards.
    const speed = 70 + Math.random() * 50;
    m.velocity
      .set(-Math.sin(angle), -0.35 - Math.random() * 0.3, Math.cos(angle))
      .multiplyScalar(Math.random() < 0.5 ? speed : -speed);
    m.velocity.y = -Math.abs(m.velocity.y);
    m.life = 0;
    m.duration = 0.6 + Math.random() * 0.8;
    m.wait = 0;
  }

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    group.current.children.forEach((mesh, i) => {
      const m = meteors[i];
      if (m.wait > 0) {
        m.wait -= dt;
        mesh.visible = false;
        if (m.wait <= 0) respawn(m);
        return;
      }
      m.life += dt;
      if (m.life >= m.duration) {
        m.wait = 2 + Math.random() * 7;
        mesh.visible = false;
        return;
      }
      m.position.addScaledVector(m.velocity, dt);
      mesh.visible = true;
      mesh.position.copy(m.position);
      dir.copy(m.velocity).normalize();
      mesh.quaternion.setFromUnitVectors(down, dir); // tail (+Y) points backwards
      // Fade in quickly, fade out slowly.
      const t = m.life / m.duration;
      mesh.material.opacity = Math.min(1, t * 6) * (1 - t);
    });
  });

  return (
    <group ref={group}>
      {meteors.map((_, i) => (
        <mesh key={i} geometry={geometry} visible={false}>
          <meshBasicMaterial
            color="#d9e4ff"
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            fog={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// Blinking fireflies drifting around the edge of the clearing.
export function Fireflies({ count = 80, innerRadius = 6, outerRadius = 30 }) {
  const points = useRef();
  const texture = useMemo(() => glowTexture(64), []);
  const { positions, colors, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const seeds = [];
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = innerRadius + Math.random() * (outerRadius - innerRadius);
      seeds.push({
        x: Math.cos(angle) * r,
        y: 0.6 + Math.random() * 3,
        z: Math.sin(angle) * r,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
        blink: 1 + Math.random() * 2.5,
      });
    }
    return { positions, colors, seeds };
  }, [count, innerRadius, outerRadius]);

  const base = useMemo(() => new THREE.Color('#d8ff7a'), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const geo = points.current.geometry;
    seeds.forEach((s, i) => {
      positions[i * 3] = s.x + Math.sin(t * s.speed + s.phase) * 1.2;
      positions[i * 3 + 1] = s.y + Math.sin(t * s.speed * 1.7 + s.phase) * 0.4;
      positions[i * 3 + 2] = s.z + Math.cos(t * s.speed * 0.8 + s.phase) * 1.2;
      const glow = Math.max(0, Math.sin(t * s.blink + s.phase)) ** 3;
      colors[i * 3] = base.r * glow;
      colors[i * 3 + 1] = base.g * glow;
      colors[i * 3 + 2] = base.b * glow;
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={texture}
        size={0.35}
        sizeAttenuation
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
