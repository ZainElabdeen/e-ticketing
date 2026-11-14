import bcrypt from 'bcryptjs';
import { decodeAdminHash } from './admin-hash';

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
const hash12 = bcrypt.hashSync('correct-horse-battery', 12);

describe('decodeAdminHash', () => {
  it('returns the bcrypt hash for valid base64 of a cost-12 hash', () => {
    expect(decodeAdminHash(b64(hash12))).toBe(hash12);
  });

  it('accepts a cost above 12', () => {
    const h = '$2b$13$' + 'a'.repeat(53);
    expect(decodeAdminHash(b64(h))).toBe(h);
  });

  it.each(['not base64 at all!', '', '$2b$12$abc', 'aGVsbG8=%'])('rejects %p', (input) => {
    expect(() => decodeAdminHash(input)).toThrow(/^ADMIN_PASSWORD_HASH_B64 /);
  });

  it('rejects base64 of text that is not a bcrypt hash', () => {
    expect(() => decodeAdminHash(b64('hello'))).toThrow(/ADMIN_PASSWORD_HASH_B64.*bcrypt/);
  });

  it('rejects cost 10', () => {
    const h10 = bcrypt.hashSync('correct-horse-battery', 10);
    expect(() => decodeAdminHash(b64(h10))).toThrow(/cost/);
  });

  it('never echoes the input in the message', () => {
    const inputs = [b64('hello'), b64(bcrypt.hashSync('x-secret-pass-12', 10)), 'not base64!!'];
    for (const input of inputs) {
      try {
        decodeAdminHash(input);
        throw new Error('expected a throw');
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain(input);
        expect(message).not.toContain(Buffer.from(input, 'base64').toString('utf8'));
      }
    }
  });
});
