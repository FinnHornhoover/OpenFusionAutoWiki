import { useEffect, useState } from 'react';

/**
 * Returns `true` only after `active` has stayed truthy for `delayMs` ms.
 * Lets us avoid the "skeleton flashing for 5ms then snapping to content" UX —
 * a cached load that resolves immediately shows no placeholder at all.
 */
export function useDelayedFlag(active: boolean, delayMs = 200): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [active, delayMs]);
  return show;
}
