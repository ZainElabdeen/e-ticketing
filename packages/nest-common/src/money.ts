/** Postgres bigint minor units to a JSON-safe number; refuses anything that would lose precision. */
export function toMinor(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Money value ${value} is not a safe integer`);
  }
  return n;
}
