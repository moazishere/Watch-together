import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRoom } from '../state/room.js';
import { chatBubbleTexture } from '../lib/textures.js';

const SHOW_MS = 6000;
const FADE_MS = 600;
const METRES_PER_PX = 0.0036; // bubble texture pixels -> world size
const BOTTOM_Y = 2.52; // tail tip, just above the name tag

// Speech bubble with this player's latest chat message, for a few seconds.
export default function ChatBubble({ id }) {
  const bubble = useRoom((s) => s.bubbles[id]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!bubble) return undefined;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), Math.max(0, SHOW_MS - (performance.now() - bubble.shownAt)));
    return () => clearTimeout(timer);
  }, [bubble]);

  if (!bubble || !visible) return null;
  return <Bubble key={bubble.id} text={bubble.text} shownAt={bubble.shownAt} />;
}

function Bubble({ text, shownAt }) {
  const ref = useRef();
  const tex = useMemo(() => chatBubbleTexture(text), [text]);
  useEffect(() => () => tex.texture.dispose(), [tex]);
  const height = tex.heightPx * METRES_PER_PX;

  useFrame(() => {
    const age = performance.now() - shownAt;
    const pop = Math.min(1, age / 150);
    const fade = age > SHOW_MS - FADE_MS ? Math.max(0, (SHOW_MS - age) / FADE_MS) : 1;
    ref.current.material.opacity = fade;
    ref.current.scale.set(height * tex.aspect * (0.85 + 0.15 * pop), height * (0.85 + 0.15 * pop), 1);
  });

  return (
    <sprite ref={ref} position-y={BOTTOM_Y} center={[0.5, 0]} scale={[height * tex.aspect, height, 1]} renderOrder={12}>
      <spriteMaterial map={tex.texture} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}
