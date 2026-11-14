const BCRYPT = /^\$2[aby]\$(1[0-9]|0[4-9])\$[./A-Za-z0-9]{53}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MIN_COST = 12;

/**
 * Decodes ADMIN_PASSWORD_HASH_B64 into the bcrypt hash. The hash is stored as
 * base64 so `$` never needs escaping in compose files or shells. Errors name
 * the problem only: the input is a credential and is never echoed.
 */
export function decodeAdminHash(b64: string): string {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length % 4 !== 0 || !BASE64.test(b64)) {
    throw new Error('ADMIN_PASSWORD_HASH_B64 must be base64');
  }
  const hash = Buffer.from(b64, 'base64').toString('utf8');
  if (!BCRYPT.test(hash)) {
    throw new Error('ADMIN_PASSWORD_HASH_B64 must decode to a bcrypt hash');
  }
  const cost = Number(hash.slice(4, 6));
  if (cost < MIN_COST) {
    throw new Error(`ADMIN_PASSWORD_HASH_B64 must use bcrypt cost ${MIN_COST} or higher`);
  }
  return hash;
}
