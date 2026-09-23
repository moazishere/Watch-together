import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import { useRoom } from '../state/room.js';
import { voiceAudio } from './voiceAudio.js';

const MIC_OPTIONS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

function describeMicError(err) {
  if (err?.name === 'NotAllowedError') return 'Microphone blocked. Allow it in the browser address bar, then try again.';
  if (err?.name === 'NotFoundError') return 'No microphone found.';
  return err?.message || 'Could not turn on the microphone';
}

// Voice chat on the shared LiveKit call. Your mic starts muted; `toggleMic`
// (V) turns it on/off and `pushToTalk(true/false)` (hold T) talks while
// muted. Remote voices are handed to the spatial audio engine, and who is
// speaking goes into the room store (room.speaking) for avatars and the HUD.
export function useVoiceChat({ call }) {
  const { room } = call;
  const [micOn, setMicOn] = useState(false);
  const [micError, setMicError] = useState(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [volume, setVolume] = useState(1);
  const pushing = useRef(false); // mic is on only because T is held

  useEffect(() => voiceAudio.setVolume(volume), [volume]);

  // Remote microphones -> spatial audio; active speakers -> store.
  useEffect(() => {
    if (!room) return undefined;
    const attach = (track, publication, participant) => {
      if (publication.source !== Track.Source.Microphone || track.kind !== 'audio') return;
      voiceAudio.add(participant.identity, track.mediaStreamTrack);
      setAudioBlocked(voiceAudio.isBlocked());
    };
    const detach = (_track, publication, participant) => {
      if (publication.source === Track.Source.Microphone) voiceAudio.remove(participant.identity);
    };
    const left = (participant) => voiceAudio.remove(participant.identity);
    const speakers = (list) =>
      useRoom.setState({ speaking: Object.fromEntries(list.map((p) => [p.identity, true])) });

    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.TrackUnsubscribed, detach);
    room.on(RoomEvent.ParticipantDisconnected, left);
    room.on(RoomEvent.ActiveSpeakersChanged, speakers);
    // Voices already there when we joined.
    for (const participant of room.remoteParticipants.values()) {
      const publication = participant.getTrackPublication(Track.Source.Microphone);
      if (publication?.track) attach(publication.track, publication, participant);
    }

    return () => {
      room.off(RoomEvent.TrackSubscribed, attach);
      room.off(RoomEvent.TrackUnsubscribed, detach);
      room.off(RoomEvent.ParticipantDisconnected, left);
      room.off(RoomEvent.ActiveSpeakersChanged, speakers);
      voiceAudio.clear();
      useRoom.setState({ speaking: {} });
      setMicOn(false);
      pushing.current = false;
    };
  }, [room]);

  // Browsers only start audio after a click or key press.
  useEffect(() => {
    const unlock = () => {
      voiceAudio.resume();
      setTimeout(() => setAudioBlocked(voiceAudio.isBlocked()), 100);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const setMic = useCallback(
    async (on) => {
      if (!room) return false;
      setMicError(null);
      try {
        await room.localParticipant.setMicrophoneEnabled(on, MIC_OPTIONS);
        setMicOn(on);
        return true;
      } catch (err) {
        setMicError(describeMicError(err));
        setMicOn(false);
        return false;
      }
    },
    [room],
  );

  const toggleMic = useCallback(() => {
    pushing.current = false;
    return setMic(!room?.localParticipant.isMicrophoneEnabled);
  }, [room, setMic]);

  // Hold-to-talk: only switches the mic if it was off when T went down.
  const pushToTalk = useCallback(
    (down) => {
      if (!room) return;
      if (down && !room.localParticipant.isMicrophoneEnabled) {
        pushing.current = true;
        setMic(true);
      } else if (!down && pushing.current) {
        pushing.current = false;
        setMic(false);
      }
    },
    [room, setMic],
  );

  return { available: Boolean(room), micOn, toggleMic, pushToTalk, micError, audioBlocked, volume, setVolume };
}
