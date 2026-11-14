import { validateEnv } from './env';

const ok = {
  DATABASE_URL: 'postgresql://x/db?schema=ledger',
  PUBLIC_API_KEY_LEDGER: 'p'.repeat(32),
  INTERNAL_API_KEY_LEDGER: 'i'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () =>
    expect(validateEnv(ok)).toMatchObject({
      PORT: 3003,
      SWAGGER_ENABLED: false,
      LOG_LEVEL: 'info',
    }));

  it('rejects a DATABASE_URL without ?schema=ledger', () =>
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'postgresql://x/db' })).toThrow(
      /DATABASE_URL/,
    ));

  it('rejects a short PUBLIC_API_KEY_LEDGER', () =>
    expect(() => validateEnv({ ...ok, PUBLIC_API_KEY_LEDGER: 'short' })).toThrow(
      /PUBLIC_API_KEY_LEDGER/,
    ));

  it('rejects a short INTERNAL_API_KEY_LEDGER', () =>
    expect(() => validateEnv({ ...ok, INTERNAL_API_KEY_LEDGER: 'short' })).toThrow(
      /INTERNAL_API_KEY_LEDGER/,
    ));

  it('rejects equal public and internal keys, naming INTERNAL_API_KEY_LEDGER', () =>
    expect(() => validateEnv({ ...ok, INTERNAL_API_KEY_LEDGER: ok.PUBLIC_API_KEY_LEDGER })).toThrow(
      /INTERNAL_API_KEY_LEDGER/,
    ));

  it('parses flags and numbers, and rejects out-of-range values', () => {
    expect(validateEnv({ ...ok, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
    expect(validateEnv({ ...ok, PORT: '4000' }).PORT).toBe(4000);
    expect(() => validateEnv({ ...ok, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...ok, SWAGGER_ENABLED: 'yes' })).toThrow(/SWAGGER_ENABLED/);
    expect(() => validateEnv({ ...ok, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('lists every invalid variable in one error', () =>
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*PUBLIC_API_KEY_LEDGER[\s\S]*INTERNAL_API_KEY_LEDGER/,
    ));
});
