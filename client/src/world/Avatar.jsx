import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { colorForId } from '../lib/random.js';
import { nameTagTexture } from '../lib/textures.js';
import FloatingReactions from './FloatingReactions.jsx';
import ChatBubble from './ChatBubble.jsx';
import { emojiTexture } from './reactions.js';
import { useRoom } from '../state/room.js';

// Rigged human (Mixamo "Soldier" from the three.js examples): 1.83 m tall,
// faces -Z like every avatar here, with Idle / Walk / Run clips.
export const AVATAR_MODEL = '/models/Soldier.glb';
useGLTF.preload(AVATAR_MODEL);

const TAG_HEIGHT = 0.34;
const FADE = 0.25; // seconds to cross-fade between clips
// Horizontal speed (m/s) thresholds and the speed each clip was animated at,
// so feet roughly match the ground whatever speed we move at.
const WALK_ABOVE = 0.4;
const RUN_ABOVE = 4.2;
const CLIP_SPEED = { Walk: 1.6, Run: 5.2 };

// Sitting: the model has no sit clip, so bend the legs on top of Idle and
// lower the body so the hips rest on a log bench (SEAT_HEIGHT).
export const SIT_POSE = {
  thigh: -1.45, // rotation of each upper leg about its local X axis (radians)
  knee: 1.5, // rotation of each lower leg about its local X axis
  lean: -0.12, // slight backwards lean of the spine
  drop: 0.42, // how far the whole body sinks (metres)
  blendTime: 0.25, // seconds to sit down / stand up
};
const X_AXIS = new THREE.Vector3(1, 0, 0);

function NameTag({ name, isHost }) {
  const tag = useMemo(() => nameTagTexture(name, { host: isHost }), [name, isHost]);
  useEffect(() => () => tag.texture.dispose(), [tag]);
  return (
    <sprite position-y={2.3} scale={[TAG_HEIGHT * tag.aspect, TAG_HEIGHT, 1]} renderOrder={10}>
      <spriteMaterial map={tag.texture} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}

// Pulsing microphone above the name tag while this player is talking.
function TalkingIndicator({ id }) {
  const speaking = useRoom((s) => Boolean(s.speaking[id]));
  const ref = useRef();
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 10) * 0.12;
    ref.current.scale.setScalar(0.34 * pulse);
  });
  if (!speaking) return null;
  return (
    <sprite ref={ref} position-y={2.66} scale={0.34} renderOrder={10}>
      <spriteMaterial map={emojiTexture('🎙️')} transparent depthWrite={false} fog={false} toneMapped={false} />
    </sprite>
  );
}

// One player's character. The parent moves and rotates the enclosing group;
// this component watches how fast it travels and plays idle / walk / run to
// match, so it works the same for the local player and for remote players.
export default function Avatar({ id, name, isHost = false, isSelf = false, seated = false }) {
  const root = useRef();
  const { scene, animations } = useGLTF(AVATAR_MODEL);

  // Each avatar needs its own skeleton, so clone with SkeletonUtils.
  const model = useMemo(() => {
    const copy = cloneSkinned(scene);
    copy.traverse((o) => {
      if (o.isSkinnedMesh) o.frustumCulled = false; // bind-pose bounds don't follow the animation
    });
    return copy;
  }, [scene]);

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model]);
  const actions = useMemo(() => {
    const byName = {};
    for (const clip of animations) {
      if (clip.name === 'TPose') continue;
      byName[clip.name] = mixer.clipAction(clip);
    }
    return byName;
  }, [animations, mixer]);

  const motion = useRef({ last: null, speed: 0, current: null, sit: seated ? 1 : 0 });
  const ring = useRef();
  const overhead = useRef(); // name tag + host ring, lowered while seated

  const bones = useMemo(() => {
    const get = (name) => model.getObjectByName(`mixamorig${name}`) ?? model.getObjectByName(`mixamorig:${name}`);
    return {
      thighs: [get('LeftUpLeg'), get('RightUpLeg')].filter(Boolean),
      knees: [get('LeftLeg'), get('RightLeg')].filter(Boolean),
      spine: get('Spine'),
    };
  }, [model]);
  const pose = useMemo(() => ({ q: new THREE.Quaternion() }), []);
  const ringColor = useMemo(() => {
    const { h } = colorForId(id);
    return new THREE.Color().setHSL(h, 0.75, 0.6);
  }, [id]);

  useEffect(() => {
    actions.Idle?.play();
    motion.current.current = 'Idle';
    return () => mixer.stopAllAction();
  }, [actions, mixer]);

  const world = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const m = motion.current;
    root.current.getWorldPosition(world);
    if (m.last && dt > 0) {
      const instant = Math.hypot(world.x - m.last.x, world.z - m.last.z) / dt;
      m.speed += (instant - m.speed) * Math.min(1, dt * 10); // smooth out network jitter
    } else {
      m.last = new THREE.Vector3();
    }
    m.last.copy(world);

    // Seated: always Idle (for breathing), legs bent afterwards.
    const next = seated ? 'Idle' : m.speed > RUN_ABOVE ? 'Run' : m.speed > WALK_ABOVE ? 'Walk' : 'Idle';
    if (next !== m.current && actions[next]) {
      const from = actions[m.current];
      const to = actions[next].reset().play();
      if (from) to.crossFadeFrom(from, FADE, true);
      m.current = next;
    }
    const action = actions[m.current];
    if (action && CLIP_SPEED[m.current]) {
      action.timeScale = THREE.MathUtils.clamp(m.speed / CLIP_SPEED[m.current], 0.7, 1.6);
    }
    mixer.update(dt);

    // Blend the sitting pose in or out on top of whatever the mixer produced.
    m.sit = THREE.MathUtils.clamp(m.sit + (seated ? dt : -dt) / SIT_POSE.blendTime, 0, 1);
    const k = m.sit * m.sit * (3 - 2 * m.sit); // smoothstep
    model.position.y = -SIT_POSE.drop * k;
    if (ring.current) ring.current.visible = k < 0.5;
    if (overhead.current) overhead.current.position.y = -SIT_POSE.drop * k;
    if (k > 0) {
      const bend = (bone, angle) => {
        pose.q.setFromAxisAngle(X_AXIS, angle * k);
        bone.quaternion.multiply(pose.q);
      };
      bones.thighs.forEach((b) => bend(b, SIT_POSE.thigh));
      bones.knees.forEach((b) => bend(b, SIT_POSE.knee));
      if (bones.spine) bend(bones.spine, SIT_POSE.lean);
    }
  });

  return (
    <group ref={root}>
      <primitive object={model} />
      {/* Player colour ring on the ground, so identical characters are easy to tell apart. */}
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[0.42, 0.5, 40]} />
        <meshBasicMaterial color={ringColor} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[0.45, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <group ref={overhead}>
        {isHost && (
          <mesh position-y={2.02} rotation-x={Math.PI / 2}>
            <torusGeometry args={[0.16, 0.025, 8, 24]} />
            <meshBasicMaterial color="#ffd66b" toneMapped={false} />
          </mesh>
        )}
        {!isSelf && <NameTag name={name} isHost={isHost} />}
        <TalkingIndicator id={id} />
        <ChatBubble id={id} />
        <FloatingReactions playerId={id} />
      </group>
    </group>
  );
}
