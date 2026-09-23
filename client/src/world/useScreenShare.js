import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, ScreenSharePresets, Track } from 'livekit-client';

const NO_TRACKS = { videoTrack: null, audioTrack: null, localSharing: false };

const TRACK_EVENTS = [
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ParticipantDisconnected,
];

// 1080p at 30 fps: motion matters more than text sharpness for movies.
const SHARE_PRESET = ScreenSharePresets.h1080fps30;
// Movie volume while friends are talking, and how fast it dips / recovers.
const DUCKED = 0.25;
const DUCK_RATE = 8;

function describeError(err) {
  if (err?.name === 'NotAllowedError') return null; // the host closed the screen picker
  return err?.message || String(err ?? 'Screen share error');
}

// The host's own screen audio, but only when the browser stopped the shared
// tab from playing it locally (tab capture): then we play it ourselves so
// the host gets the volume slider and the dip under voices too. With
// whole-screen/system audio the system keeps playing it, so we don't.
function localScreenAudio(room) {
  const audio = room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.mediaStreamTrack;
  if (!audio) return null;
  if (audio.getSettings?.().suppressLocalAudioPlayback === true) return audio;
  // Some browsers apply the constraint without reporting it back.
  const video = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
  const isTab = video?.getSettings?.().displaySurface === 'browser';
  const supported = navigator.mediaDevices?.getSupportedConstraints?.().suppressLocalAudioPlayback === true;
  return isTab && supported ? audio : null;
}

// The subscribed MediaStreamTrack for a source, from any remote participant.
function remoteTrack(room, source) {
  for (const participant of room.remoteParticipants.values()) {
    const publication = participant.getTrackPublication(source);
    if (publication?.isSubscribed && publication.track) return publication.track.mediaStreamTrack;
  }
  return null;
}

// The host's screen on the shared LiveKit call: video for the in-world
// screen, audio through a hidden <audio> element that dips while someone
// talks (`duck`), for viewers and (tab capture) the host alike. The host
// starts and stops sharing here.
export function useScreenShare({ call, onLocalShareChange, duck = false }) {
  const { room } = call;
  const [tracks, setTracks] = useState(NO_TRACKS);
  const [error, setError] = useState(null);
  const [volume, setVolume] = useState(0.8);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const audioRef = useRef(null);
  const gain = useRef(1); // current duck multiplier
  const onChange = useRef(onLocalShareChange);
  onChange.current = onLocalShareChange;

  useEffect(() => {
    if (!room) {
      setTracks(NO_TRACKS);
      return undefined;
    }
    const refresh = () => {
      // The host's own share is local; viewers receive it as a remote track.
      const localVideo = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack;
      const videoTrack = localVideo ?? remoteTrack(room, Track.Source.ScreenShare);
      const audioTrack = localScreenAudio(room) ?? remoteTrack(room, Track.Source.ScreenShareAudio);
      const localSharing = Boolean(localVideo);
      setTracks((s) =>
        s.videoTrack === videoTrack && s.audioTrack === audioTrack && s.localSharing === localSharing
          ? s
          : { videoTrack, audioTrack, localSharing },
      );
    };
    const published = (pub) => pub.source === Track.Source.ScreenShare && onChange.current?.(true);
    // Also fires when the host clicks the browser's own "Stop sharing" button.
    const unpublished = (pub) => pub.source === Track.Source.ScreenShare && onChange.current?.(false);

    TRACK_EVENTS.forEach((e) => room.on(e, refresh));
    room.on(RoomEvent.LocalTrackPublished, published);
    room.on(RoomEvent.LocalTrackUnpublished, unpublished);
    refresh();
    return () => {
      TRACK_EVENTS.forEach((e) => room.off(e, refresh));
      room.off(RoomEvent.LocalTrackPublished, published);
      room.off(RoomEvent.LocalTrackUnpublished, unpublished);
      if (room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) onChange.current?.(false);
    };
  }, [room]);

  // Screen audio: viewers, and the host when sharing a tab (see localScreenAudio).
  useEffect(() => {
    if (!tracks.audioTrack) return undefined;
    const audio = new Audio();
    audio.srcObject = new MediaStream([tracks.audioTrack]);
    audio.volume = volume * gain.current;
    audioRef.current = audio;
    audio.play().then(
      () => setAudioBlocked(false),
      () => setAudioBlocked(true), // autoplay policy: needs a click first
    );
    return () => {
      audio.pause();
      audio.srcObject = null;
      audioRef.current = null;
    };
    // Volume changes are applied below without recreating the element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks.audioTrack]);

  // Apply the volume slider, easing the duck in and out.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    const target = duck ? DUCKED : 1;
    const step = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      gain.current += (target - gain.current) * Math.min(1, dt * DUCK_RATE);
      if (Math.abs(target - gain.current) < 0.01) gain.current = target;
      if (audioRef.current) audioRef.current.volume = Math.min(1, volume * gain.current);
      if (gain.current !== target) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [volume, duck]);

  const resumeAudio = useCallback(() => {
    audioRef.current?.play().then(() => setAudioBlocked(false), () => {});
  }, []);

  const startShare = useCallback(async () => {
    if (!room) return;
    setError(null);
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          // Ask for tab/system audio too: a movie without sound isn't much of a
          // movie. Keep it clean (no voice processing), and stop a shared tab
          // from also playing locally so the host hears it through the app.
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            suppressLocalAudioPlayback: true,
          },
          systemAudio: 'include',
          selfBrowserSurface: 'exclude',
          contentHint: 'motion',
          resolution: SHARE_PRESET.resolution,
        },
        { screenShareEncoding: SHARE_PRESET.encoding },
      );
    } catch (err) {
      const message = describeError(err);
      if (message) setError(message);
    }
  }, [room]);

  const stopShare = useCallback(() => {
    room?.localParticipant.setScreenShareEnabled(false).catch(() => {});
  }, [room]);

  return {
    ...tracks,
    callState: call.callState,
    error: error ?? call.error,
    startShare,
    stopShare,
    volume,
    setVolume,
    audioBlocked,
    resumeAudio,
  };
}
