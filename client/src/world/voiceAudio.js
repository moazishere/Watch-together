import * as THREE from 'three';

// Spatial voice: every remote microphone plays through its own Web Audio
// PannerNode placed at that player's head, and the listener follows the
// camera, so voices come from where people stand: panned left/right, a bit
// quieter across the clearing, but never drowned out by the movie.

// Distance model (linear): full volume within REF_DISTANCE, easing down to
// (1 - ROLLOFF) = 35% at MAX_DISTANCE and staying there beyond it.
const REF_DISTANCE = 3;
const ROLLOFF = 0.65;
const MAX_DISTANCE = 30;
// Voices are naturally much quieter than movie audio: boost them, with a
// compressor after the boost so loud talkers don't clip.
const VOICE_BOOST = 1.8;

let ctx = null;
let master = null;
let volume = 1; // user's voice volume slider, 0..2
const forward = new THREE.Vector3();
const voices = new Map(); // identity -> { element, source, panner }

function context() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = volume * VOICE_BOOST;
    const limiter = new DynamicsCompressorNode(ctx, { threshold: -18, knee: 12, ratio: 4, attack: 0.003, release: 0.25 });
    master.connect(limiter).connect(ctx.destination);
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
      distanceModel: 'linear',
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

  // 0 = silent, 1 = normal, 2 = twice as loud.
  setVolume(value) {
    volume = value;
    if (master) master.gain.value = volume * VOICE_BOOST;
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
