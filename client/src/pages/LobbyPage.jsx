import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { acceptFriend, createRoom, listEnvironments, listFriends, listRooms, removeFriend, requestFriend } from '../lib/data.js';
import { useAuth } from '../state/auth.js';
import { isEnvironmentPlayable } from '../world/environments/index.js';

const REFRESH_MS = 8000;

export default function LobbyPage() {
  const { user, logout } = useAuth();

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1 className="brand">Watch Together</h1>
        <div className="row">
          <span className="muted">Signed in as {user.name}</span>
          <button className="btn small" onClick={logout}>
            Log out
          </button>
        </div>
      </header>
      <div className="lobby-grid">
        <div className="stack">
          <CreateRoom userId={user.id} />
          <Rooms userId={user.id} />
        </div>
        <Friends userId={user.id} />
      </div>
    </div>
  );
}

function CreateRoom({ userId }) {
  const navigate = useNavigate();
  const [environments, setEnvironments] = useState([]);
  const [environmentId, setEnvironmentId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEnvironments()
      .then((environments) => {
        setEnvironments(environments);
        setEnvironmentId(environments.find(isEnvironmentPlayable)?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const room = await createRoom(userId, environmentId);
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="card panel">
      <h2>Host a watch party</h2>
      <p className="muted small">Pick a place, invite friends, then share your screen on the big screen.</p>
      <form className="row" onSubmit={create}>
        <select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} aria-label="Environment">
          {environments.map((env) => (
            <option key={env.id} value={env.id} disabled={!isEnvironmentPlayable(env)}>
              {env.name}
              {isEnvironmentPlayable(env) ? '' : ' (coming soon)'}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={busy || !environmentId}>
          Create room
        </button>
      </form>
      {error && <p className="error small">{error}</p>}
      <Link className="small" to="/preview">
        Preview the environment
      </Link>
    </section>
  );
}

function Rooms({ userId }) {
  const [rooms, setRooms] = useState(null);
  const [online, setOnline] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await listRooms();
        if (!alive) return;
        setRooms(list);
        setError('');
        // Who's inside right now lives on the realtime server, not in the database.
        if (list.length) {
          const { online } = await api(`/rooms/presence?ids=${list.map((r) => r.id).join(',')}`);
          if (alive) setOnline(online);
        }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <section className="card panel">
      <h2>Rooms</h2>
      {error && <p className="error small">{error}</p>}
      {rooms === null ? (
        <p className="muted small">Loading…</p>
      ) : rooms.length === 0 ? (
        <p className="muted small">No open rooms. Create one, or ask a friend to invite you.</p>
      ) : (
        <ul className="list rooms">
          {rooms.map((r) => (
            <li key={r.id}>
              <div>
                <div className="row">
                  <strong>{r.environment.name}</strong>
                  <span className={`pill${r.status === 'live' ? ' live' : ''}`}>
                    {r.status === 'live' ? 'LIVE' : 'Waiting'}
                  </span>
                </div>
                <span className="muted small">
                  {r.host.id === userId ? 'Your room' : `Hosted by ${r.host.name}`} · {online[r.id] ?? 0} inside
                </span>
              </div>
              <Link className="btn primary small" to={`/room/${r.id}`}>
                {r.host.id === userId ? 'Open' : 'Join'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Friends({ userId }) {
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(null);

  const load = useCallback(
    () =>
      listFriends()
        .then(setData)
        .catch((e) => setMessage({ error: true, text: e.message })),
    [],
  );

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function run(fn) {
    setMessage(null);
    try {
      const success = await fn();
      if (typeof success === 'string') setMessage({ text: success });
      await load();
    } catch (e) {
      setMessage({ error: true, text: e.message });
    }
  }

  function add(e) {
    e.preventDefault();
    run(async () => {
      const status = await requestFriend(email);
      setEmail('');
      return status === 'accepted' ? 'You are now friends' : 'Request sent';
    });
  }

  return (
    <section className="card panel">
      <h2>Friends</h2>
      <form className="row" onSubmit={add}>
        <input
          type="email"
          placeholder="Friend's email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-label="Friend's email"
        />
        <button className="btn primary">Add</button>
      </form>
      {message && <p className={`small ${message.error ? 'error' : 'muted'}`}>{message.text}</p>}

      {data.incoming.length > 0 && (
        <>
          <h3 className="subhead">Requests</h3>
          <ul className="list">
            {data.incoming.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name} <span className="muted small">{p.email}</span>
                </span>
                <span className="row">
                  <button className="btn small primary" onClick={() => run(() => acceptFriend(p.id, userId))}>
                    Accept
                  </button>
                  <button className="btn small" onClick={() => run(() => removeFriend(p.id, userId))}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="subhead">Your friends</h3>
      {data.friends.length === 0 ? (
        <p className="muted small">No friends yet. Add someone by the email they signed up with.</p>
      ) : (
        <ul className="list">
          {data.friends.map((p) => (
            <li key={p.id}>
              <span>
                {p.name} <span className="muted small">{p.email}</span>
              </span>
              <button
                className="btn small"
                onClick={() => window.confirm(`Remove ${p.name} from your friends?`) && run(() => removeFriend(p.id, userId))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {data.outgoing.length > 0 && (
        <>
          <h3 className="subhead">Pending</h3>
          <ul className="list">
            {data.outgoing.map((p) => (
              <li key={p.id}>
                <span>
                  {p.name} <span className="muted small">{p.email}</span>
                </span>
                <button className="btn small" onClick={() => run(() => removeFriend(p.id, userId))}>
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
