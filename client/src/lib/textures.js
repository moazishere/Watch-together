import * as THREE from 'three';

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Soft round dot: fireflies, glows.
export function glowTexture(size = 64) {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// Disc that fades out towards its edge, in the given colour.
export function radialFadeTexture(color, size = 256) {
  return canvasTexture(size, (ctx, s) => {
    const c = new THREE.Color(color);
    const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, `rgba(${rgb},1)`);
    g.addColorStop(0.7, `rgba(${rgb},0.85)`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// Text card for the in-world screen when nothing is being shared.
export function screenPlaceholderTexture(title, subtitle) {
  const w = 1280;
  const h = 720;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#1b2a5c');
  bg.addColorStop(1, '#2a1a52');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8ecff';
  ctx.font = '600 64px system-ui, sans-serif';
  ctx.fillText(title, w / 2, h / 2 - 10);
  if (subtitle) {
    ctx.fillStyle = '#b3bdf0';
    ctx.font = '36px system-ui, sans-serif';
    ctx.fillText(subtitle, w / 2, h / 2 + 60);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Pill-shaped name label for avatars. Returns the texture and its aspect ratio.
export function nameTagTexture(name, { host = false } = {}) {
  const scale = 2; // render at 2x for crisp text
  const font = `600 ${28 * scale}px system-ui, sans-serif`;
  const label = host ? `★ ${name}` : name;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const padX = 18 * scale;
  const h = 48 * scale;
  const w = Math.ceil(measure.measureText(label).width + padX * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(5, 8, 20, 0.72)';
  ctx.strokeStyle = host ? 'rgba(255, 214, 107, 0.7)' : 'rgba(143, 160, 230, 0.35)';
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.roundRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e6eaff';
  ctx.fillText(label, w / 2, h / 2 + scale);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h };
}
