import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SEAT_HEIGHT } from '@watch-together/shared';

const LOG_RADIUS = SEAT_HEIGHT / 2;

// Log benches from seatLayout(). Each log lies along the sitters' left-right
// axis, so a group rotated by the bench's rotationY only has to turn the
// cylinder onto its side.
export default function Benches({ benches, highlight }) {
  const materials = useMemo(
    () => [
      new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 1, flatShading: true }), // bark
      new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.9, flatShading: true }), // cut end
      new THREE.MeshStandardMaterial({ color: '#8a6a48', roughness: 0.9, flatShading: true }),
    ],
    [],
  );

  return (
    <group>
      {benches.map((bench) => (
        <group key={bench.id} position={[bench.x, 0, bench.z]} rotation-y={bench.rotationY}>
          <mesh position-y={LOG_RADIUS} rotation-z={Math.PI / 2} material={materials}>
            <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS * 1.08, bench.length, 9]} />
          </mesh>
          {/* A couple of stones wedged under each end so the log doesn't look like it floats. */}
          {[-1, 1].map((side) => (
            <mesh key={side} position={[side * (bench.length / 2 - 0.25), 0.06, 0.18]} scale={[0.16, 0.1, 0.14]}>
              <dodecahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#4a5266" roughness={1} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      {highlight && <SeatMarker seat={highlight} />}
    </group>
  );
}

// Soft pulsing ring on the seat you'd sit on if you pressed E.
function SeatMarker({ seat }) {
  const ref = useRef();
  useFrame(({ clock }) => {
    const pulse = 0.75 + Math.sin(clock.elapsedTime * 4) * 0.25;
    ref.current.material.opacity = pulse;
    ref.current.scale.setScalar(0.9 + pulse * 0.15);
  });
  return (
    <mesh ref={ref} position={[seat.x, SEAT_HEIGHT + 0.02, seat.z]} rotation-x={-Math.PI / 2}>
      <ringGeometry args={[0.2, 0.28, 32]} />
      <meshBasicMaterial color="#9ec1ff" transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
