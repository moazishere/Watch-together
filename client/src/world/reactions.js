import * as THREE from 'three';
import { REACTIONS } from '@watch-together/shared';

// In-memory bus for emoji reactions: the socket (or the local player) emits,
// floating emojis and the cinema-mode stream listen. Nothing is stored.
const listeners = new Set();

export const reactionBus = {
  emit(playerId, reaction) {
    if (!Number.isInteger(reaction) || !REACTIONS[reaction]) return;
    const event = { playerId, reaction, emoji: REACTIONS[reaction], at: performance.now() };
    listeners.forEach((listener) => listener(event));
  },
  // listener({ playerId, reaction, emoji, at }); returns an unsubscribe function.
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

// Keys 1-5 (top row or numpad) -> reaction index, or -1.
export function reactionForKey(code) {
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  const index = match ? Number(match[1]) - 1 : -1;
  return index < REACTIONS.length ? index : -1;
}

// One texture per emoji, drawn with the system's colour emoji font.
const textures = new Map();
export function emojiTexture(emoji) {
  let texture = textures.get(emoji);
  if (!texture) {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.font = `${size * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.set(emoji, texture);
  }
  return texture;
}
