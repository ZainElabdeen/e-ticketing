/** Delay before the next outbox attempt; `attempts` is the value after increment. */
export function nextAttemptDelaySeconds(attempts: number): number {
  return Math.min(2 ** attempts, 300);
}
