// Shared by admin-hash.mjs and setup-local.mjs. bcryptjs is loaded from the
// gateway package, so `pnpm install` is a prerequisite.
import { createRequire } from 'node:module';
import { randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COST = 12;
// bcrypt ignores everything past byte 72, so a longer password would be truncated silently.
export const MAX_BYTES = 72;
// No 0, O, 1, l or I: easy to misread when typed from the login file.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

const here = dirname(fileURLToPath(import.meta.url));
const requireFromGateway = createRequire(
  join(here, '..', '..', '..', 'apps', 'gateway', 'package.json'),
);
const bcrypt = requireFromGateway('bcryptjs');

/** Base64 of a bcrypt cost-12 hash. Base64 keeps `$` out of compose files and shells. */
export async function hashAdminPassword(password) {
  if (Buffer.byteLength(password) > MAX_BYTES) {
    throw new Error(`Password must be at most ${MAX_BYTES} bytes (bcrypt ignores anything longer)`);
  }
  return Buffer.from(await bcrypt.hash(password, COST)).toString('base64');
}

export function generatePassword(length = 20) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
