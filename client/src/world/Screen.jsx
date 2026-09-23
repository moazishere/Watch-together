import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { screenPlaceholderTexture } from '../lib/textures.js';

// Plays a MediaStreamTrack into a <video> element and exposes it as a texture.
function useVideoTexture(track) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!track) {
      setState(null);
      return undefined;
    }
    const video = document.createElement('video');
    video.muted = true; // audio is played separately (see useScreenShare)
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([track]);

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    const update = () => setState({ texture, aspect: video.videoWidth / video.videoHeight || 16 / 9 });
    video.addEventListener('loadedmetadata', update);
    video.addEventListener('resize', update);
    video.play().catch(() => {});
    setState({ texture, aspect: 16 / 9 });

    return () => {
      video.removeEventListener('loadedmetadata', update);
      video.removeEventListener('resize', update);
      video.pause();
      video.srcObject = null;
      texture.dispose();
    };
  }, [track]);

  return state;
}

// The big in-world screen, placed per environments.screen_position.
export default function Screen({ placement, track, title = 'Waiting for the host', subtitle = '' }) {
  const { x = 0, y = 4, z = -12, rotation_y: rotationY = 0, width = 12.8, height = 7.2 } = placement;
  const video = useVideoTexture(track);
  const placeholder = useMemo(() => screenPlaceholderTexture(title, subtitle), [title, subtitle]);
  useEffect(() => () => placeholder.dispose(), [placeholder]);

  // Fit the picture inside the frame, keeping its aspect ratio.
  let w = width;
  let h = height;
  if (video) {
    if (video.aspect > width / height) h = width / video.aspect;
    else w = height * video.aspect;
  }

  const legHeight = y - height / 2;
  return (
    <group position={[x, y, z]} rotation-y={rotationY}>
      <mesh position-z={-0.18}>
        <boxGeometry args={[width + 0.5, height + 0.5, 0.3]} />
        <meshStandardMaterial color="#10131c" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position-z={0.001}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh position-z={0.01}>
        <planeGeometry args={[w, h]} />
        <meshBasicMaterial map={video?.texture ?? placeholder} toneMapped={false} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * width * 0.32, -height / 2 - legHeight / 2, -0.2]}>
          <cylinderGeometry args={[0.12, 0.16, legHeight, 8]} />
          <meshStandardMaterial color="#1a1e29" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}
      {/* Light spilling from the screen onto the clearing. */}
      <pointLight position={[0, -height / 2 + 1, 4]} color={video ? '#b8c8ff' : '#6d7fcf'} intensity={video ? 30 : 12} distance={22} decay={1.6} />
    </group>
  );
}
