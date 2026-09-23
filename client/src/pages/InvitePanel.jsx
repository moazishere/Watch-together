import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { inviteToRoom, listFriends } from '../lib/data.js';

// Host-only: invite accepted friends into the room (straight to Supabase), or
// revoke an invite (through the server, which also removes them from the room).
export default function InvitePanel({ roomId, initialInvites }) {
  const [friends, setFriends] = useState([]);
  const [invited, setInvited] = useState(initialInvites);
  const [error, setError] = useState('');

  useEffect(() => {
    listFriends()
      .then((d) => setFriends(d.friends))
      .catch((e) => setError(e.message));
  }, []);

  const invitedIds = new Set(invited.map((i) => i.id));
  const invitable = friends.filter((f) => !invitedIds.has(f.id));

  async function invite(friend) {
    setError('');
    try {
      await inviteToRoom(roomId, friend.id);
      setInvited((list) => [...list, { id: friend.id, name: friend.name }]);
    } catch (e) {
      setError(e.message);
    }
  }

  async function revoke(person) {
    setError('');
    try {
      await api(`/rooms/${roomId}/invites/${person.id}`, { method: 'DELETE' });
      setInvited((list) => list.filter((i) => i.id !== person.id));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <details className="invite-panel">
      <summary>Invite friends ({invited.length} invited)</summary>
      {invited.length > 0 && (
        <ul className="list">
          {invited.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span>
              <button className="btn small" onClick={() => revoke(p)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {invitable.length > 0 ? (
        <ul className="list">
          {invitable.map((f) => (
            <li key={f.id}>
              <span>{f.name}</span>
              <button className="btn small primary" onClick={() => invite(f)}>
                Invite
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          {friends.length === 0 ? 'Add friends from the lobby to invite them.' : 'All your friends are invited.'}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </details>
  );
}
