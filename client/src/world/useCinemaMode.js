import { useCallback, useEffect, useState } from 'react';

const HINT_MS = 2500;

// Cinema mode state for a 3D page: toggled by LocalPlayer (C / Esc). Returns
// the flag, the toggle, and whether the brief "C to exit" hint should show.
export function useCinemaMode() {
  const [cinema, setCinema] = useState(false);
  const [hint, setHint] = useState(false);
  const toggleCinema = useCallback(() => setCinema((on) => !on), []);

  useEffect(() => {
    if (!cinema) {
      setHint(false);
      return undefined;
    }
    setHint(true);
    const timer = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [cinema]);

  return { cinema, toggleCinema, showCinemaHint: hint };
}
