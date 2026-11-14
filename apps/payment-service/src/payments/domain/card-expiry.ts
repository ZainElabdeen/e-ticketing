/** Expired means before the current UTC month; the current month is still valid. */
export function isCardExpired(expMonth: number, expYear: number, now: Date): boolean {
  const cardIndex = expYear * 12 + (expMonth - 1);
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return cardIndex < nowIndex;
}
