import * as THREE from 'three';

// Spatial voice: every remote microphone plays through its own Web Audio
// PannerNode placed at that player's head, and the listener follows the
// camera, so voices come from where people stand: louder nearby, quieter
// across the clearing, panned left/right.

// Distance model: full volume within REF_DISTANCE, then falls off
// (inverse model: gain = ref / (ref + rolloff * (d - ref))).
const REF_DISTANCE = 2;
const ROLLOFF = 1.3;
const MAX_DISTANCE = 45;

let ctx = null;
let master = null;
const forward = new THREE.Vector3();
const voices = new Map(); // identity -> { element, source, panner }

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return ctx;
}

function setParam(param, value) {
  if (Number.isFinite(value)) param.value = value;
}

export const voiceAudio = {
  add(identity, track) {
    this.remove(identity);
    const c = context();
    const stream = new MediaStream([track]);
    // Chrome only feeds remote WebRTC audio into Web Audio when the stream is
    // also attached to a media element, so attach a muted one.
    const element = new Audio();
    element.muted = true;
    element.srcObject = stream;
    element.play().catch(() => {});

    const source = c.createMediaStreamSource(stream);
    const panner = new PannerNode(c, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: REF_DISTANCE,
      rolloffFactor: ROLLOFF,
      maxDistance: MAX_DISTANCE,
    });
    source.connect(panner).connect(master);
    voices.set(identity, { element, source, panner });
  },

  remove(identity) {
    const voice = voices.get(identity);
    if (!voice) return;
    voice.source.disconnect();
    voice.panner.disconnect();
    voice.element.pause();
    voice.element.srcObject = null;
    voices.delete(identity);
  },

  clear() {
    [...voices.keys()].forEach((identity) => this.remove(identity));
  },

  // Browsers keep audio suspended until the user interacts with the page.
  resume() {
    if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
  },

  isBlocked() {
    return Boolean(ctx && ctx.state !== 'running' && voices.size > 0);
  },

  setVolume(volume) {
    if (master) master.gain.value = volume;
  },

  // Called every frame: listener = camera, each voice = that player's head.
  // positionOf(identity) returns { x, y, z } or null.
  update(camera, positionOf) {
    if (!ctx || voices.size === 0) return;
    const { listener } = ctx;
    const { x, y, z } = camera.position;
    camera.getWorldDirection(forward);
    if (listener.positionX) {
      setParam(listener.positionX, x);
      setParam(listener.positionY, y);
      setParam(listener.positionZ, z);
      setParam(listener.forwardX, forward.x);
      setParam(listener.forwardY, forward.y);
      setParam(listener.forwardZ, forward.z);
      setParam(listener.upX, camera.up.x);
      setParam(listener.upY, camera.up.y);
      setParam(listener.upZ, camera.up.z);
    } else {
      // Firefox: older API.
      listener.setPosition(x, y, z);
      listener.setOrientation(forward.x, forward.y, forward.z, camera.up.x, camera.up.y, camera.up.z);
    }
    for (const [identity, voice] of voices) {
      const p = positionOf(identity);
      if (!p) continue;
      setParam(voice.panner.positionX, p.x);
      setParam(voice.panner.positionY, p.y);
      setParam(voice.panner.positionZ, p.z);
    }
  },
};
