import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { OrbitControls } from '@react-three/drei';
import { seatLayout } from '@watch-together/shared';
import { listEnvironments } from '../lib/data.js';
import WorldCanvas from '../world/WorldCanvas.jsx';
import Screen from '../world/Screen.jsx';
import BoundsOutline from '../world/BoundsOutline.jsx';
import Benches from '../world/Benches.jsx';
import LocalPlayer from '../world/LocalPlayer.jsx';
import { getSceneComponent } from '../world/environments/index.js';
import { useAuth } from '../state/auth.js';
import { createTestPatternTrack } from '../lib/testPattern.js';
import { useCinemaMode } from '../world/useCinemaMode.js';
import { reactionBus } from '../world/reactions.js';
import ReactionStream from '../world/ReactionStream.jsx';

// Build-order steps 2 and 3, no networking: fly around an environment, or walk
// it as a single player (benches included). /preview?env=<environment id>
export default function PreviewPage() {
  const [params] = useSearchParams();
  const [environments, setEnvironments] = useState(null);
  const [error, setError] = useState('');
  const user = useAuth((s) => s.user);

  useEffect(() => {
    listEnvironments()
      .then(setEnvironments)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="page-message error">{error}</p>;
  if (!environments) return <p className="page-message">Loading…</p>;

  const env =
    environments.find((e) => e.id === params.get('env')) ??
    environments.find((e) => getSceneComponent(e.assetConfig.kind));
  if (!env || !getSceneComponent(env.assetConfig.kind)) return <p className="page-message">No playable environment found.</p>;
  return <EnvironmentPreview env={env} user={user} />;
}

export function EnvironmentPreview({ env, user, initialWalking = false }) {
  const Scene = getSceneComponent(env.assetConfig.kind);
  const [showBounds, setShowBounds] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [walking, setWalking] = useState(initialWalking);
  const [locked, setLocked] = useState(false);
  const [testPattern, setTestPattern] = useState(false);
  const [track, setTrack] = useState(null);
  const [seatId, setSeatId] = useState(null);
  const [nearSeatId, setNearSeatId] = useState(null);
  const { cinema, toggleCinema, showCinemaHint } = useCinemaMode();

  const { benches, seats } = useMemo(() => seatLayout(env.screenPosition, env.assetConfig.seats), [env]);
  const seatById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);
  const noneTaken = useMemo(() => new Set(), []);

  // Checks the screen's video texture path without a LiveKit call.
  useEffect(() => {
    if (!testPattern) return undefined;
    const pattern = createTestPatternTrack();
    setTrack(pattern.track);
    return () => {
      pattern.stop();
      setTrack(null);
    };
  }, [testPattern]);

  // Single player: sitting is local, no server involved.
  const interact = () => setSeatId((current) => (current ? null : nearSeatId));

  return (
    <div className={`world-page${cinema ? ' cinema' : ''}`}>
      <WorldCanvas camera={{ position: [0, 7, 17] }}>
        <Scene config={env.assetConfig} />
        <Screen placement={env.screenPosition} track={track} title={env.name} subtitle="Scene preview" />
        <Benches benches={benches} highlight={walking && !seatId && nearSeatId ? seatById.get(nearSeatId) : null} />
        {showBounds && <BoundsOutline bounds={env.walkableBounds} />}
        {walking ? (
          <LocalPlayer
            id={user.id}
            name={user.name}
            bounds={env.walkableBounds}
            spawn={{ ...env.assetConfig.spawn, rotationY: 0 }}
            screen={env.screenPosition}
            seat={seatId ? seatById.get(seatId) : null}
            seats={seats}
            takenSeatIds={noneTaken}
            onPointerLockChange={setLocked}
            onNearbySeat={setNearSeatId}
            onInteract={interact}
            onStand={() => setSeatId(null)}
            cinema={cinema}
            onToggleCinema={toggleCinema}
            onReact={(reaction) => reactionBus.emit(user.id, reaction)}
          />
        ) : (
          <OrbitControls
            target={[0, 3, -5]}
            autoRotate={autoRotate}
            autoRotateSpeed={0.35}
            enableDamping
            maxPolarAngle={Math.PI / 2 - 0.05}
            minDistance={4}
            maxDistance={90}
          />
        )}
      </WorldCanvas>
      {walking && !locked && (
        <div className="center-prompt card">
          Click to look around · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> sit · <kbd>C</kbd> cinema · <kbd>1</kbd>–<kbd>5</kbd> react · scroll to zoom
        </div>
      )}
      {walking && locked && <div className="crosshair" />}
      {cinema && <ReactionStream names={{ [user.id]: user.name }} />}
      {showCinemaHint && (
        <div className="cinema-hint card small">
          Cinema mode · <kbd>C</kbd> to exit
        </div>
      )}
      {walking && (seatId || nearSeatId) && (
        <div className="seat-prompt card small">
          {seatId ? (
            <>
              Enjoy the show · <kbd>E</kbd> or move to stand up
            </>
          ) : (
            <>
              <kbd>E</kbd> Sit down
            </>
          )}
        </div>
      )}
      <div className="hud hud-top-left card">
        <strong>{env.name}</strong>
        <span className="muted small">{walking ? 'Esc releases the mouse' : 'Drag to orbit · scroll to zoom'}</span>
        <label className="check">
          <input type="checkbox" checked={walking} onChange={(e) => setWalking(e.target.checked)} /> Walk (single
          player)
        </label>
        {!walking && (
          <label className="check">
            <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} /> Fly
            around
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={testPattern} onChange={(e) => setTestPattern(e.target.checked)} /> Test
          pattern on screen
        </label>
        <label className="check">
          <input type="checkbox" checked={showBounds} onChange={(e) => setShowBounds(e.target.checked)} /> Show walkable
          bounds
        </label>
        <Link to="/lobby" className="small">
          ← Back to lobby
        </Link>
      </div>
    </div>
  );
}
