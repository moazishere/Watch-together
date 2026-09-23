import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { constrainMove, nearestFreeSeat } from '@watch-together/shared';
import SafeAvatar from './SafeAvatar.jsx';
import { SIT_POSE } from './Avatar.jsx';
import { reactionForKey } from './reactions.js';

// Human pace, matched to the character's walk and run animations.
const WALK_SPEED = 2.4;
const RUN_SPEED = 5.6;
const JUMP_SPEED = 6;
const GRAVITY = 20;
const HEAD_HEIGHT = 1.62;
const SEATED_HEAD_HEIGHT = HEAD_HEIGHT - SIT_POSE.drop;
const MOUSE_SENSITIVITY = 0.0022;
const KEY_TURN_SPEED = 2.2; // rad/s for the arrow keys
const PITCH_MIN = -0.55; // looking up
const PITCH_MAX = 1.1; // looking down
const MIN_ZOOM = 0; // first person
const MAX_ZOOM = 9;
const FIRST_PERSON_BELOW = 0.9;
const SHOULDER_OFFSET = 0.75;
// Seats: how close you need to be for the "Press E" prompt, where you end up
// when you stand, and the camera you glide into when you sit.
const SEAT_PROMPT_REACH = 1.8;
const STAND_STEP = 0.8;
const SEATED_ZOOM = 2.2;
const GLIDE_RATE = 4;
// Cinema mode: seconds to glide in/out, and how much of the view the screen fills.
const CINEMA_BLEND_TIME = 0.9;
const CINEMA_FILL = 0.7;

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
const STAND_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'Space'];

function isTyping(event) {
  const tag = event.target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function useKeys(handlers) {
  const keys = useRef(new Set());
  const on = useRef(handlers);
  on.current = handlers;
  useEffect(() => {
    const down = (e) => {
      if (isTyping(e)) return;
      if (MOVE_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'KeyE' && !on.current.cinema) on.current.onInteract?.();
        if (e.code === 'KeyC') on.current.onToggleCinema?.();
        if (e.code === 'Escape' && on.current.cinema) on.current.onToggleCinema?.();
        const reaction = reactionForKey(e.code);
        if (reaction >= 0) on.current.onReact?.(reaction);
        if (e.code === 'KeyV') on.current.onToggleMic?.();
        if (e.code === 'KeyT') on.current.onPushToTalk?.(true);
      }
      keys.current.add(e.code);
    };
    const up = (e) => {
      if (e.code === 'KeyT') on.current.onPushToTalk?.(false);
      keys.current.delete(e.code);
    };
    const clear = () => {
      if (keys.current.has('KeyT')) on.current.onPushToTalk?.(false);
      keys.current.clear();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []);
  return keys;
}

// The player you control: WASD to walk, mouse to look (click the scene to
// capture the pointer), Shift to run, Space to jump, scroll to zoom between
// first and third person, E to sit on / get up from a bench. Movement is
// constrained to the walkable bounds.
// - onMove(x, y, z, rotationY) runs every frame while standing; the caller decides what to send.
// - seat: the seat you're on (or null). seats/takenSeatIds: all seats and which are occupied.
// - onNearbySeat(seatId | null) fires when the closest free seat in reach changes.
// - onInteract() on E; onStand() when a movement key is pressed while seated.
// - cinema / onToggleCinema(): C (or Esc) toggles a fixed, centred view of the
//   screen; the camera glides between it and the normal view, and movement
//   and mouse look pause while it's on.
// - onReact(index): keys 1-5 send an emoji reaction (see REACTIONS).
// - onToggleMic() on V; onPushToTalk(true/false) while T is held.
export default function LocalPlayer({
  id,
  name,
  isHost,
  bounds,
  spawn,
  screen,
  seat = null,
  seats = [],
  takenSeatIds,
  onMove,
  onPointerLockChange,
  onNearbySeat,
  onInteract,
  onStand,
  cinema = false,
  onToggleCinema,
  onReact,
  onToggleMic,
  onPushToTalk,
}) {
  const { camera, gl, size } = useThree();
  const avatar = useRef();
  const keys = useKeys({ onInteract, onToggleCinema, onReact, onToggleMic, onPushToTalk, cinema });
  const cinemaBlend = useRef(0);
  const cinemaPose = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), look: new THREE.Vector3() });
  const playerPose = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion() });
  const body = useRef({ x: spawn.x, y: 0, z: spawn.z, vy: 0 });
  const look = useRef({ yaw: spawn.rotationY ?? 0, pitch: 0.12, zoom: 4.5 });
  const glide = useRef(null); // camera target after sitting: { yaw, pitch, zoom }
  const showBody = useRef(true);
  const nearby = useRef(null);
  const standing = useRef(false); // stand requested, waiting for the seat prop to clear
  const tmp = useRef({ head: new THREE.Vector3(), dir: new THREE.Vector3() });
  const props = useRef({});
  props.current = { seats, takenSeatIds, onNearbySeat, onStand, onMove, cinema };

  // Sitting down: snap onto the seat and glide the camera to face the screen.
  // Standing up: step forward off the log.
  const seatId = seat?.id ?? null;
  useEffect(() => {
    const b = body.current;
    if (!seat) return undefined;
    b.x = seat.x;
    b.z = seat.z;
    b.y = 0;
    b.vy = 0;
    const sx = screen?.x ?? 0;
    const sy = screen?.y ?? 4;
    const sz = screen?.z ?? 0;
    const dist = Math.hypot(sx - seat.x, sz - seat.z);
    glide.current = {
      yaw: seat.rotationY,
      pitch: -Math.atan2(sy - SEATED_HEAD_HEIGHT, dist) * 0.8,
      zoom: SEATED_ZOOM,
    };
    standing.current = false;
    return () => {
      const next = constrainMove(
        bounds,
        b.x,
        b.z,
        b.x - Math.sin(seat.rotationY) * STAND_STEP,
        b.z - Math.cos(seat.rotationY) * STAND_STEP,
      );
      b.x = next.x;
      b.z = next.z;
      glide.current = null;
    };
    // Only react to which seat we're on, not to a new seat object with the same id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatId]);

  // Pointer lock + mouse look + scroll zoom. Moving the mouse cancels a camera glide.
  useEffect(() => {
    const canvas = gl.domElement;
    const requestLock = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    };
    const onLockChange = () => onPointerLockChange?.(document.pointerLockElement === canvas);
    const onMouseMove = (e) => {
      if (document.pointerLockElement !== canvas || props.current.cinema) return;
      glide.current = null;
      look.current.yaw -= e.movementX * MOUSE_SENSITIVITY;
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch + e.movementY * MOUSE_SENSITIVITY, PITCH_MIN, PITCH_MAX);
    };
    const onWheel = (e) => {
      e.preventDefault();
      if (props.current.cinema) return;
      glide.current = null;
      look.current.zoom = THREE.MathUtils.clamp(look.current.zoom + e.deltaY * 0.005, MIN_ZOOM, MAX_ZOOM);
    };
    canvas.addEventListener('click', requestLock);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      canvas.removeEventListener('click', requestLock);
      canvas.removeEventListener('wheel', onWheel);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    };
  }, [gl, onPointerLockChange]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const k = keys.current;
    const b = body.current;
    const l = look.current;
    const p = props.current;

    if (!p.cinema && k.has('ArrowLeft')) l.yaw += KEY_TURN_SPEED * dt;
    if (!p.cinema && k.has('ArrowRight')) l.yaw -= KEY_TURN_SPEED * dt;

    if (p.cinema) {
      // Movement is paused while watching in cinema mode.
    } else if (seat) {
      // Any movement key gets you up.
      if (!standing.current && STAND_KEYS.some((code) => k.has(code))) {
        standing.current = true;
        p.onStand?.();
      }
    } else {
      // Walk relative to where the camera faces.
      const forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const strafe = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      if (forward || strafe) {
        const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED;
        const len = Math.hypot(forward, strafe);
        const sin = Math.sin(l.yaw);
        const cos = Math.cos(l.yaw);
        const vx = ((-sin * forward + cos * strafe) / len) * speed;
        const vz = ((-cos * forward - sin * strafe) / len) * speed;
        const next = constrainMove(bounds, b.x, b.z, b.x + vx * dt, b.z + vz * dt);
        b.x = next.x;
        b.z = next.z;
      }

      // Jump.
      if (k.has('Space') && b.y === 0) b.vy = JUMP_SPEED;
      if (b.y > 0 || b.vy > 0) {
        b.vy -= GRAVITY * dt;
        b.y = Math.max(0, b.y + b.vy * dt);
        if (b.y === 0) b.vy = 0;
      }
    }

    // Ease the camera into the seated view.
    const g = glide.current;
    if (g) {
      const t = 1 - Math.exp(-GLIDE_RATE * dt);
      l.yaw += shortestAngle(l.yaw, g.yaw) * t;
      l.pitch += (g.pitch - l.pitch) * t;
      l.zoom += (g.zoom - l.zoom) * t;
      if (Math.abs(shortestAngle(l.yaw, g.yaw)) < 0.002 && Math.abs(g.pitch - l.pitch) < 0.002) glide.current = null;
    }

    avatar.current.position.set(b.x, b.y, b.z);
    // Seated, the body faces the screen while you look around freely.
    avatar.current.rotation.y = seat ? seat.rotationY : l.yaw;

    // Camera orbits behind the head; zoom 0 is first person.
    const { head, dir } = tmp.current;
    head.set(b.x, b.y + (seat ? SEATED_HEAD_HEIGHT : HEAD_HEIGHT), b.z);
    const cp = Math.cos(l.pitch);
    dir.set(-Math.sin(l.yaw) * cp, -Math.sin(l.pitch), -Math.cos(l.yaw) * cp);
    // Over-the-shoulder: shift sideways so your own avatar doesn't block the screen.
    const shoulder = Math.min(SHOULDER_OFFSET, l.zoom * 0.2);
    head.x += Math.cos(l.yaw) * shoulder;
    head.z -= Math.sin(l.yaw) * shoulder;
    camera.position.copy(head).addScaledVector(dir, -l.zoom);
    camera.position.y = Math.max(0.3, camera.position.y);
    camera.lookAt(head.x + dir.x * 10, head.y + dir.y * 10, head.z + dir.z * 10);

    // Cinema mode: blend from the player camera to a centred shot of the screen.
    cinemaBlend.current = THREE.MathUtils.clamp(cinemaBlend.current + (p.cinema ? dt : -dt) / CINEMA_BLEND_TIME, 0, 1);
    const c = cinemaBlend.current;
    if (c > 0) {
      const e = c * c * (3 - 2 * c); // smoothstep
      const player = playerPose.current;
      player.pos.copy(camera.position);
      player.quat.copy(camera.quaternion);

      // Far enough back that the screen fills CINEMA_FILL of the view both ways,
      // a little below its centre like a cinema seat.
      const cine = cinemaPose.current;
      const { x: sx = 0, y: sy = 4, z: sz = 0, rotation_y: sr = 0, width = 12.8, height = 7.2 } = screen ?? {};
      const halfTan = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const aspect = size.width / Math.max(1, size.height);
      const dist = Math.max(height / (2 * halfTan * CINEMA_FILL), width / (2 * halfTan * aspect * CINEMA_FILL));
      cine.look.set(sx, sy, sz);
      camera.position.set(sx + Math.sin(sr) * dist, Math.max(1.2, sy - 0.6), sz + Math.cos(sr) * dist);
      camera.lookAt(cine.look);
      cine.pos.copy(camera.position);
      cine.quat.copy(camera.quaternion);

      camera.position.lerpVectors(player.pos, cine.pos, e);
      camera.quaternion.slerpQuaternions(player.quat, cine.quat, e);
    }

    const firstPerson = l.zoom < FIRST_PERSON_BELOW;
    if (showBody.current === firstPerson) {
      showBody.current = !firstPerson;
      avatar.current.visible = !firstPerson;
    }

    // Closest free seat within reach, for the "Press E to sit" prompt.
    const near = seat ? null : (nearestFreeSeat(p.seats, b.x, b.z, p.takenSeatIds, SEAT_PROMPT_REACH)?.id ?? null);
    if (near !== nearby.current) {
      nearby.current = near;
      p.onNearbySeat?.(near);
    }

    if (!seat) p.onMove?.(b.x, b.y, b.z, l.yaw);
  });

  return (
    <group ref={avatar}>
      <SafeAvatar id={id} name={name} isHost={isHost} isSelf seated={Boolean(seat)} />
    </group>
  );
}
