import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { CHAT_MAX_LENGTH } from '@watch-together/shared';
import { colorForId } from '../lib/random.js';

const RECENT_MS = 10000; // cinema mode only shows messages this new

const nameColor = (id) => {
  const { h } = colorForId(id);
  return `hsl(${Math.round(h * 360)} 75% 70%)`;
};

// Room text chat. Enter (handled by LocalPlayer) calls ref.open(); Enter sends,
// Esc cancels, and focus goes back to the game either way. In `compact`
// (cinema) mode only recent messages show, and the input only while typing.
const ChatPanel = forwardRef(function ChatPanel({ messages, selfId, onSend, compact = false }, ref) {
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const input = useRef(null);
  const list = useRef(null);

  useImperativeHandle(ref, () => ({
    open() {
      setTyping(true);
      input.current?.focus(); // compact mode renders the input first; the effect below focuses it then
    },
  }));

  useEffect(() => {
    if (typing && document.activeElement !== input.current) input.current?.focus();
  }, [typing]);

  // Keep the newest message in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length, typing, compact]);

  // In cinema mode, re-check which messages are still "recent".
  useEffect(() => {
    if (!compact) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [compact]);

  useEffect(() => {
    if (!error) return undefined;
    const timer = setTimeout(() => setError(''), 3000);
    return () => clearTimeout(timer);
  }, [error]);

  const close = () => {
    setTyping(false);
    input.current?.blur();
  };

  async function submit(e) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return close();
    const res = await onSend(message);
    if (res.ok) {
      setText('');
      close();
    } else {
      setError(res.error);
    }
  }

  const shown = compact ? messages.filter((m) => now - m.at < RECENT_MS).slice(-5) : messages.slice(-40);
  const showInput = !compact || typing;
  if (compact && !shown.length && !typing) return null;

  return (
    <section className={`chat-panel${compact ? ' compact' : ''}${typing ? ' typing' : ''}`} aria-label="Chat">
      <ol className="chat-messages" ref={list} aria-live="polite">
        {!compact && messages.length === 0 && <li className="chat-empty">No messages yet. Press Enter to say hi.</li>}
        {shown.map((m) => (
          <li key={m.id} className={m.userId === selfId ? 'mine' : undefined}>
            <strong style={{ color: nameColor(m.userId) }}>{m.name}</strong> {m.text}
          </li>
        ))}
      </ol>
      {showInput && (
        <form onSubmit={submit} className="chat-form">
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            maxLength={CHAT_MAX_LENGTH}
            placeholder={typing ? 'Say something… (Enter to send, Esc to cancel)' : 'Press Enter to chat'}
            aria-label="Chat message"
            autoComplete="off"
          />
        </form>
      )}
      {error && <p className="error small chat-error">{error}</p>}
    </section>
  );
});

export default ChatPanel;
