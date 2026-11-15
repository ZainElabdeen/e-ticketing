import { useEffect, useState } from 'react';

/** Remaining time until `expiresAt`, ticking once a second. `now` is injectable for tests. */
export function useCountdown(
  expiresAt: string,
  now: () => number = Date.now,
): { remainingMs: number; expired: boolean } {
  const target = new Date(expiresAt).getTime();
  const [current, setCurrent] = useState(() => now());
  const remainingMs = Math.max(0, target - current);

  useEffect(() => {
    const id = setInterval(() => {
      const t = now();
      setCurrent(t);
      if (t >= target) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [target, now]);

  return { remainingMs, expired: remainingMs <= 0 };
}
