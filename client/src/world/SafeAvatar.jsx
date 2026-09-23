import { Component, Suspense } from 'react';
import Avatar from './Avatar.jsx';

// Simple stand-in shown while the character model loads, or instead of it if
// the model can't be loaded, so one player's avatar can never break the scene.
function PlaceholderBody() {
  return (
    <mesh position-y={0.85}>
      <capsuleGeometry args={[0.3, 1.0, 4, 12]} />
      <meshStandardMaterial color="#6b7394" roughness={0.7} />
    </mesh>
  );
}

class AvatarErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn('Avatar model failed to load; showing a placeholder instead.', error);
  }

  render() {
    return this.state.failed ? <PlaceholderBody /> : this.props.children;
  }
}

export default function SafeAvatar(props) {
  return (
    <AvatarErrorBoundary>
      <Suspense fallback={<PlaceholderBody />}>
        <Avatar {...props} />
      </Suspense>
    </AvatarErrorBoundary>
  );
}
