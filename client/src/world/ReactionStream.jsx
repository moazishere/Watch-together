import { useEffect, useState } from 'react';
import { reactionBus } from './reactions.js';

const LIFETIME_MS = 2600;
const MAX_ACTIVE = 24;
let nextKey = 0;

// Livestream-style reactions rising up the right edge of the page. Shown in
// cinema mode, where people's heads are usually out of frame.
export default function ReactionStream({ names }) {
  const [items, setItems] = useState([]);

  useEffect(
    () =>
      reactionBus.subscribe((event) => {
        const item = { key: nextKey++, emoji: event.emoji, from: names?.[event.playerId], drift: Math.random() * 60 };
        setItems((list) => [...list.slice(-(MAX_ACTIVE - 1)), item]);
        setTimeout(() => setItems((list) => list.filter((i) => i.key !== item.key)), LIFETIME_MS);
      }),
    [names],
  );

  return (
    <div className="reaction-stream" aria-hidden="true">
      {items.map((item) => (
        <span key={item.key} className="reaction-stream-item" style={{ right: `${24 + item.drift}px` }}>
          {item.emoji}
          {item.from && <small>{item.from}</small>}
        </span>
      ))}
    </div>
  );
}
