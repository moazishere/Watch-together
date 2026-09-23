import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { remoteTransforms, useRoom } from '../state/room.js';
import SafeAvatar from './SafeAvatar.jsx';

// Updates arrive ~15 times a second; ease towards them so motion looks smooth.
const SMOOTHING = 12;

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function RemoteAvatar({ player }) {
  const ref = useRef();

  useLayoutEffect(() => {
    const t = remoteTransforms.get(player.id);
    if (t) {
      ref.current.position.set(t.x, t.y, t.z);
      ref.current.rotation.y = t.rotationY;
    }
  }, [player.id]);

  useFrame((_, delta) => {
    const t = remoteTransforms.get(player.id);
    if (!t) return;
    const k = 1 - Math.exp(-SMOOTHING * Math.min(delta, 0.1));
    const obj = ref.current;
    obj.position.x += (t.x - obj.position.x) * k;
    obj.position.y += (t.y - obj.position.y) * k;
    obj.position.z += (t.z - obj.position.z) * k;
    obj.rotation.y += shortestAngle(obj.rotation.y, t.rotationY) * k;
  });

  return (
    <group ref={ref}>
      <SafeAvatar id={player.id} name={player.name} isHost={player.isHost} seated={Boolean(player.seatId)} />
    </group>
  );
}

export default function RemotePlayers() {
  const players = useRoom((s) => s.players);
  return Object.values(players).map((p) => <RemoteAvatar key={p.id} player={p} />);
}
