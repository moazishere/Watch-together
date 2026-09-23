import { useFrame } from '@react-three/fiber';
import { remoteTransforms, useRoom } from '../state/room.js';
import { voiceAudio } from './voiceAudio.js';
import { SIT_POSE } from './Avatar.jsx';

const HEAD_HEIGHT = 1.62;

// Keeps the spatial audio in step with the 3D world: the listener follows the
// camera and each voice sits at its player's head (lower when seated).
export default function SpatialVoice() {
  useFrame(({ camera }) => {
    const { players } = useRoom.getState();
    voiceAudio.update(camera, (identity) => {
      const t = remoteTransforms.get(identity);
      if (!t) return null;
      const head = players[identity]?.seatId ? HEAD_HEIGHT - SIT_POSE.drop : HEAD_HEIGHT;
      return { x: t.x, y: t.y + head, z: t.z };
    });
  });
  return null;
}
