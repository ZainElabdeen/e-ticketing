import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * PAY-<UTC yyyymmdd>-<6 Crockford base32 chars>. Each random byte maps with
 * `byte % 32`; 32 divides 256, so the mapping is uniform. The reference is a
 * simulation identifier, not a secret.
 */
export function newPaymentReference(
  now: Date,
  random: (bytes: number) => Buffer = randomBytes,
): string {
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (const byte of random(6)) suffix += CROCKFORD[byte % 32];
  return `PAY-${yyyy}${mm}${dd}-${suffix}`;
}
