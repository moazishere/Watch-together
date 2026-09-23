import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { emojiTexture, reactionBus } from './reactions.js';

const LIFETIME = 2.4; // seconds on screen
const RISE = 1.2; // metres travelled upwards
const SIZE = 0.55; // sprite size in metres
const START_Y = 2.2; // just above the head
const MAX_ACTIVE = 8; // per avatar, so spamming can't pile up forever

let nextKey = 0;

// Emojis that pop out above one player's head, drift up and fade away.
export default function FloatingReactions({ playerId }) {
  const [items, setItems] = useState([]);

  useEffect(
    () =>
      reactionBus.subscribe((event) => {
        if (event.playerId !== playerId) return;
        const item = { key: nextKey++, emoji: event.emoji, offset: (Math.random() - 0.5) * 0.5, phase: Math.random() * 6 };
        setItems((list) => [...list.slice(-(MAX_ACTIVE - 1)), item]);
      }),
    [playerId],
  );

  const done = (key) => setItems((list) => list.filter((i) => i.key !== key));

  return items.map((item) => <FloatingEmoji key={item.key} item={item} onDone={done} />);
}

function FloatingEmoji({ item, onDone }) {
  const ref = useRef();
  const age = useRef(0);
  const finished = useRef(false);

  useFrame((_, delta) => {
    age.current += Math.min(delta, 0.1);
    const t = age.current / LIFETIME;
    if (t >= 1) {
      if (!finished.current) {
        finished.current = true;
        onDone(item.key);
      }
      return;
    }
    const sprite = ref.current;
    const rise = 1 - (1 - t) ** 2; // ease out
    sprite.position.set(item.offset + Math.sin(age.current * 3 + item.phase) * 0.1, START_Y + rise * RISE, 0);
    // Pop in with a little overshoot, then settle.
    const pop = t < 0.08 ? THREE.MathUtils.lerp(0.3, 1.25, t / 0.08) : t < 0.16 ? THREE.MathUtils.lerp(1.25, 1, (t - 0.08) / 0.08) : 1;
    sprite.scale.setScalar(SIZE * pop);
    sprite.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
  });

  return (
    <sprite ref={ref} position-y={START_Y} scale={SIZE * 0.3} renderOrder={11}>
      <spriteMaterial map={emojiTexture(item.emoji)} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}
