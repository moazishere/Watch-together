import { REACTIONS } from '@watch-together/shared';

// Clickable version of the 1-5 reaction keys.
export default function ReactionBar({ onReact }) {
  return (
    <div className="reaction-bar" role="group" aria-label="Reactions">
      {REACTIONS.map((emoji, i) => (
        <button
          key={emoji}
          type="button"
          className="reaction-button"
          title={`React ${emoji} (key ${i + 1})`}
          onClick={(e) => {
            onReact(i);
            e.currentTarget.blur(); // keep Space for jumping, not re-clicking
          }}
        >
          <span>{emoji}</span>
          <kbd>{i + 1}</kbd>
        </button>
      ))}
    </div>
  );
}
