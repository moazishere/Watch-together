import { useEffect, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';
import { api } from '../lib/api.js';

// One LiveKit connection per watch room, shared by voice chat and screen
// share. Connects while `enabled` and returns { room, callState, error };
// `room` is only set once connected.
export function useLiveKitRoom({ roomId, enabled }) {
  const [state, setState] = useState({ room: null, callState: 'idle', error: null });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    // Screen tracks feed a WebGL texture and voices feed Web Audio, not
    // visible <video> elements, so LiveKit's visibility-based adaptive stream
    // would pause them: keep it off.
    const room = new Room({ adaptiveStream: false, dynacast: false });

    room.on(RoomEvent.Reconnecting, () => !cancelled && setState((s) => ({ ...s, callState: 'reconnecting' })));
    room.on(RoomEvent.Reconnected, () => !cancelled && setState((s) => ({ ...s, callState: 'joined' })));
    room.on(RoomEvent.Disconnected, () => {
      if (!cancelled) setState({ room: null, callState: 'error', error: 'Disconnected from the call. Reload to reconnect.' });
    });

    (async () => {
      setState({ room: null, callState: 'joining', error: null });
      try {
        const { url, token } = await api(`/rooms/${roomId}/call`, { method: 'POST' });
        if (cancelled) return;
        await room.connect(url, token, { autoSubscribe: true });
        if (cancelled) return;
        setState({ room, callState: 'joined', error: null });
      } catch (err) {
        if (!cancelled) setState({ room: null, callState: 'error', error: err?.message || 'Could not join the call' });
      }
    })();

    return () => {
      cancelled = true;
      room.disconnect();
      setState({ room: null, callState: 'idle', error: null });
    };
  }, [roomId, enabled]);

  return state;
}
