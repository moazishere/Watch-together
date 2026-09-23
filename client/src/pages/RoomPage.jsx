import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { getRoom, recordJoin } from '../lib/data.js';
import { seatLayout } from '@watch-together/shared';
import { useAuth } from '../state/auth.js';
import { useRoom } from '../state/room.js';
import WorldCanvas from '../world/WorldCanvas.jsx';
import Screen from '../world/Screen.jsx';
import LocalPlayer from '../world/LocalPlayer.jsx';
import RemotePlayers from '../world/RemotePlayers.jsx';
import Benches from '../world/Benches.jsx';
import { getSceneComponent } from '../world/environments/index.js';
import { useRoomSocket } from '../world/useRoomSocket.js';
import { useScreenShare } from '../world/useScreenShare.js';
import { useLiveKitRoom } from '../world/useLiveKitRoom.js';
import { useVoiceChat } from '../world/useVoiceChat.js';
import SpatialVoice from '../world/SpatialVoice.jsx';
import { useCinemaMode } from '../world/useCinemaMode.js';
import InvitePanel from './InvitePanel.jsx';
import ReactionBar from './ReactionBar.jsx';
import ReactionStream from '../world/ReactionStream.jsx';

export default function RoomPage() {
  const { roomId } = useParams();
  const userId = useAuth((s) => s.user.id);
  const [details, setDetails] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    setDetails(null);
    setLoadError('');
    (async () => {
      // Room data comes straight from Supabase (RLS hides rooms you weren't
      // invited to); the screen-share flag comes from the realtime server.
      const [room, config] = await Promise.all([getRoom(roomId), api('/config')]);
      if (!alive) return;
      if (!room) {
        setLoadError("This room doesn't exist, or you haven't been invited.");
        return;
      }
      if (room.status !== 'ended') await recordJoin(room.id, userId);
      if (alive) {
        setDetails({
          room,
          isHost: room.host.id === userId,
          environment: room.environment,
          invites: room.invites,
          screenShareAvailable: config.screenShare,
        });
      }
    })().catch((e) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [roomId, userId]);

  if (loadError) return <RoomMessage title="Can't open this room" body={loadError} />;
  if (!details) return <p className="page-message">Loading room…</p>;
  if (details.room.status === 'ended') return <RoomMessage title="This room has ended" />;
  if (!getSceneComponent(details.environment.assetConfig.kind)) {
    return <RoomMessage title={`${details.environment.name} isn't available yet`} />;
  }
  return <Room details={details} />;
}

function RoomMessage({ title, body }) {
  return (
    <main className="page-message">
      <div className="card auth-card">
        <h2>{title}</h2>
        {body && <p className="muted">{body}</p>}
        <Link className="btn primary" to="/lobby">
          Back to lobby
        </Link>
      </div>
    </main>
  );
}

function Room({ details }) {
  const { room, isHost, environment, screenShareAvailable } = details;
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const { connection, error, endedReason, selfId, spawn, players, status, sharing, selfSeatId } = useRoom();
  const { sendMove, announceShare, sit, stand, react } = useRoomSocket(room.id);
  // One LiveKit call for voice (from the moment you're in) and screen share.
  const call = useLiveKitRoom({
    roomId: room.id,
    enabled: screenShareAvailable && Boolean(spawn) && connection !== 'ended',
  });
  const speaking = useRoom((s) => s.speaking);
  const othersTalking = Object.keys(speaking).some((id) => id !== user.id);
  const share = useScreenShare({ call, onLocalShareChange: announceShare, duck: othersTalking });
  const voice = useVoiceChat({ call });
  const [locked, setLocked] = useState(false);
  const { cinema, toggleCinema, showCinemaHint } = useCinemaMode();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const Scene = getSceneComponent(environment.assetConfig.kind);

  const hostAction = useCallback(
    async (path) => {
      setBusy(true);
      setActionError('');
      try {
        await api(`/rooms/${room.id}/${path}`, { method: 'POST' });
      } catch (e) {
        setActionError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [room.id],
  );

  // Seats: same layout the server uses, so ids match.
  const { benches, seats } = useMemo(
    () => seatLayout(environment.screenPosition, environment.assetConfig.seats),
    [environment],
  );
  const seatById = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const takenSeatIds = useMemo(
    () => new Set(Object.values(players).map((p) => p.seatId).filter(Boolean)),
    [players],
  );
  const [nearSeatId, setNearSeatId] = useState(null);
  const names = useMemo(
    () => ({ [user.id]: user.name, ...Object.fromEntries(Object.values(players).map((p) => [p.id, p.name])) }),
    [players, user.id, user.name],
  );
  const interact = useCallback(async () => {
    setActionError('');
    if (useRoom.getState().selfSeatId) return stand();
    if (!nearSeatId) return;
    const res = await sit(nearSeatId);
    if (!res.ok) setActionError(res.error);
  }, [nearSeatId, sit, stand]);

  if (connection === 'ended') {
    return (
      <RoomMessage
        title="The room has ended"
        body={endedReason === 'host_left' ? 'The host left the room.' : 'The host closed the room.'}
      />
    );
  }
  if (connection === 'error' && !spawn) return <RoomMessage title="Couldn't join the room" body={error} />;

  const screenText = screenCopy({ status, sharing, isHost, screenShareAvailable, share, hostName: room.host.name });
  const people = [{ id: user.id, name: user.name, isHost, self: true }, ...Object.values(players)];

  return (
    <div className={`world-page${cinema ? ' cinema' : ''}`}>
      <WorldCanvas camera={{ position: [0, 6, 20] }}>
        <Scene config={environment.assetConfig} />
        <Screen
          placement={environment.screenPosition}
          track={share.videoTrack}
          title={screenText.title}
          subtitle={screenText.subtitle}
        />
        <Benches benches={benches} highlight={!selfSeatId && nearSeatId ? seatById.get(nearSeatId) : null} />
        <RemotePlayers />
        <SpatialVoice />
        {spawn && (
          <LocalPlayer
            key={selfId}
            id={user.id}
            name={user.name}
            isHost={isHost}
            bounds={environment.walkableBounds}
            spawn={spawn}
            screen={environment.screenPosition}
            seat={selfSeatId ? seatById.get(selfSeatId) : null}
            seats={seats}
            takenSeatIds={takenSeatIds}
            onMove={sendMove}
            onPointerLockChange={setLocked}
            onNearbySeat={setNearSeatId}
            onInteract={interact}
            onStand={stand}
            cinema={cinema}
            onToggleCinema={toggleCinema}
            onReact={react}
            onToggleMic={voice.toggleMic}
            onPushToTalk={voice.pushToTalk}
          />
        )}
      </WorldCanvas>

      {!locked && spawn && (
        <div className="center-prompt card small">
          Click to look around · <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> sit on a bench · <kbd>C</kbd>
          cinema mode · <kbd>1</kbd>–<kbd>5</kbd> react · <kbd>V</kbd>
          mic · hold <kbd>T</kbd> to talk · scroll to zoom · <kbd>Esc</kbd> for the menu
        </div>
      )}
      {locked && <div className="crosshair" />}
      {cinema && <ReactionStream names={names} />}
      {showCinemaHint && (
        <div className="cinema-hint card small">
          Cinema mode · <kbd>C</kbd> to exit
        </div>
      )}
      {(selfSeatId || nearSeatId) && (
        <div className="seat-prompt card small">
          {selfSeatId ? (
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

      <aside className="hud hud-top-left card">
        <div className="row">
          <strong>{environment.name}</strong>
          <StatusPill status={status} sharing={sharing} />
        </div>
        <span className="muted small">Hosted by {room.host.name}</span>
        {connection === 'connecting' && <span className="muted small">Connecting…</span>}
        {connection === 'reconnecting' && <span className="error small">Connection lost, reconnecting…</span>}
        {connection === 'error' && <span className="error small">{error}</span>}
        <ul className="people">
          {people.map((p) => (
            <li key={p.id}>
              <span className="dot" />
              {p.name}
              {p.self && <span className="muted"> (you)</span>}
              {p.isHost && <span className="host-badge">host</span>}
              {speaking[p.id] && (
                <span className="talking" title="Talking">
                  🎙️
                </span>
              )}
            </li>
          ))}
        </ul>
        {isHost && <InvitePanel roomId={room.id} initialInvites={details.invites} />}
      </aside>

      <div className="hud hud-top-right">
        <button className="btn" onClick={() => navigate('/lobby')}>
          Leave
        </button>
      </div>

      <div className="hud hud-bottom card">
        <ReactionBar onReact={react} />
        {voice.available && (
          <button
            className={`btn mic${voice.micOn ? ' on' : ''}${voice.micOn && speaking[user.id] ? ' speaking' : ''}`}
            onClick={voice.toggleMic}
            title="Toggle your microphone (V). Hold T to talk while muted. Headphones stop the movie echoing into your mic."
          >
            {voice.micOn ? '🎙️ Mic on' : '🔇 Mic off'} <kbd>V</kbd>
          </button>
        )}
        {isHost && status === 'waiting' && (
          <button className="btn primary" disabled={busy} onClick={() => hostAction('start')}>
            Start session
          </button>
        )}
        {isHost && status === 'live' && screenShareAvailable && !share.localSharing && share.callState !== 'error' && (
          <button className="btn live" disabled={share.callState !== 'joined'} onClick={share.startShare}>
            {share.callState === 'joined' ? 'Share screen' : 'Connecting…'}
          </button>
        )}
        {isHost && share.localSharing && (
          <button className="btn" onClick={share.stopShare}>
            Stop sharing
          </button>
        )}
        {!isHost && share.audioTrack && (
          <label className="volume">
            🔊
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={share.volume}
              onChange={(e) => share.setVolume(Number(e.target.value))}
              aria-label="Volume"
            />
          </label>
        )}
        {(share.audioBlocked || voice.audioBlocked) && (
          <button className="btn primary" onClick={share.resumeAudio}>
            Enable sound
          </button>
        )}
        {isHost && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => window.confirm('End the room for everyone?') && hostAction('end')}
          >
            End room
          </button>
        )}
        {!isHost && status === 'waiting' && <span className="muted small">Waiting for {room.host.name} to start…</span>}
        {!isHost && status === 'live' && !sharing && <span className="muted small">Live · waiting for the screen share</span>}
        {!isHost && sharing && <span className="muted small">Now showing: {room.host.name}'s screen</span>}
        {(actionError || voice.micError || share.error) && (
          <span className="error small">{actionError || voice.micError || share.error}</span>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status, sharing }) {
  if (status === 'live') return <span className="pill live">{sharing ? 'LIVE · sharing' : 'LIVE'}</span>;
  return <span className="pill">Waiting</span>;
}

function screenCopy({ status, sharing, isHost, screenShareAvailable, share, hostName }) {
  if (status === 'waiting') {
    return isHost
      ? { title: 'Your room is ready', subtitle: 'Invite friends, then press Start session' }
      : { title: `Waiting for ${hostName}`, subtitle: 'The show starts soon' };
  }
  if (!screenShareAvailable) return { title: 'Session is live', subtitle: 'Screen share is not configured on this server' };
  if (sharing || share.localSharing) return { title: 'Connecting to the stream…', subtitle: '' };
  if (share.callState === 'error') return { title: 'Stream unavailable', subtitle: "The screen-share call couldn't connect" };
  return isHost
    ? { title: "You're live", subtitle: 'Press Share screen to put something on' }
    : { title: `${hostName} is getting ready`, subtitle: 'The screen share will appear here' };
}
