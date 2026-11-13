import { validateEnv } from './env';

const ok = {
  DATABASE_URL: 'postgresql://x',
  PUBLIC_API_KEY_TICKET: 'p'.repeat(32),
  INTERNAL_API_KEY_TICKET: 'i'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () =>
    expect(validateEnv(ok)).toMatchObject({
      PORT: 3001,
      LOG_LEVEL: 'info',
      ORDER_TTL_MINUTES: 15,
      ORDER_EXPIRY_INTERVAL_SECONDS: 60,
      ORDER_EXPIRY_BATCH_SIZE: 100,
      ORDER_EXPIRY_ENABLED: true,
      SWAGGER_ENABLED: false,
    }));

  it('rejects a short key', () =>
    expect(() => validateEnv({ ...ok, PUBLIC_API_KEY_TICKET: 'short' })).toThrow(
      /PUBLIC_API_KEY_TICKET/,
    ));

  it('rejects equal public and internal keys', () =>
    expect(() => validateEnv({ ...ok, INTERNAL_API_KEY_TICKET: ok.PUBLIC_API_KEY_TICKET })).toThrow(
      /INTERNAL_API_KEY_TICKET/,
    ));

  it('rejects a missing DATABASE_URL', () =>
    expect(() => validateEnv({ ...ok, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/));

  it('parses "false" as false', () =>
    expect(validateEnv({ ...ok, ORDER_EXPIRY_ENABLED: 'false' }).ORDER_EXPIRY_ENABLED).toBe(false));

  it('parses numeric strings and rejects out-of-range values', () => {
    expect(validateEnv({ ...ok, PORT: '4000' }).PORT).toBe(4000);
    expect(() => validateEnv({ ...ok, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...ok, ORDER_EXPIRY_BATCH_SIZE: '1001' })).toThrow(
      /ORDER_EXPIRY_BATCH_SIZE/,
    );
  });

  it('rejects a non-boolean flag and an unknown log level', () => {
    expect(() => validateEnv({ ...ok, SWAGGER_ENABLED: 'yes' })).toThrow(/SWAGGER_ENABLED/);
    expect(() => validateEnv({ ...ok, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('lists every invalid variable', () =>
    expect(() => validateEnv({})).toThrow(
      /DATABASE_URL[\s\S]*PUBLIC_API_KEY_TICKET[\s\S]*INTERNAL_API_KEY_TICKET/,
    ));
});
