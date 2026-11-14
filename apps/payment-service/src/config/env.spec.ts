import { validateEnv } from './env';

const ok = {
  DATABASE_URL: 'postgresql://x/db?schema=payments',
  PUBLIC_API_KEY_PAYMENT: 'p'.repeat(32),
  TICKET_SERVICE_URL: 'http://ticket:3001',
  LEDGER_SERVICE_URL: 'http://ledger:3003',
  INTERNAL_API_KEY_TICKET: 't'.repeat(32),
  INTERNAL_API_KEY_LEDGER: 'l'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults', () =>
    expect(validateEnv(ok)).toMatchObject({
      PORT: 3002,
      DOWNSTREAM_TIMEOUT_MS: 5000,
      QR_SUCCESS_DELAY_SECONDS: 8,
      QR_JOB_INTERVAL_SECONDS: 1,
      QR_JOB_BATCH_SIZE: 50,
      QR_JOB_ENABLED: true,
      OUTBOX_INTERVAL_SECONDS: 2,
      OUTBOX_BATCH_SIZE: 10,
      OUTBOX_MAX_ATTEMPTS: 10,
      OUTBOX_ENABLED: true,
      SWAGGER_ENABLED: false,
      LOG_LEVEL: 'info',
    }));

  it('rejects a non-URL TICKET_SERVICE_URL', () =>
    expect(() => validateEnv({ ...ok, TICKET_SERVICE_URL: 'not a url' })).toThrow(
      /TICKET_SERVICE_URL/,
    ));

  it('rejects a non-URL LEDGER_SERVICE_URL', () =>
    expect(() => validateEnv({ ...ok, LEDGER_SERVICE_URL: 'nope' })).toThrow(/LEDGER_SERVICE_URL/));

  it('rejects a short INTERNAL_API_KEY_LEDGER', () =>
    expect(() => validateEnv({ ...ok, INTERNAL_API_KEY_LEDGER: 'short' })).toThrow(
      /INTERNAL_API_KEY_LEDGER/,
    ));

  it('rejects a DATABASE_URL without ?schema=payments', () =>
    expect(() => validateEnv({ ...ok, DATABASE_URL: 'postgresql://x/db' })).toThrow(
      /DATABASE_URL/,
    ));

  it('parses flags and numbers, and rejects out-of-range values', () => {
    expect(validateEnv({ ...ok, QR_JOB_ENABLED: 'false' }).QR_JOB_ENABLED).toBe(false);
    expect(validateEnv({ ...ok, PORT: '4000' }).PORT).toBe(4000);
    expect(() => validateEnv({ ...ok, PORT: '70000' })).toThrow(/PORT/);
    expect(() => validateEnv({ ...ok, DOWNSTREAM_TIMEOUT_MS: '99' })).toThrow(
      /DOWNSTREAM_TIMEOUT_MS/,
    );
    expect(() => validateEnv({ ...ok, QR_SUCCESS_DELAY_SECONDS: '301' })).toThrow(
      /QR_SUCCESS_DELAY_SECONDS/,
    );
    expect(() => validateEnv({ ...ok, OUTBOX_MAX_ATTEMPTS: '101' })).toThrow(/OUTBOX_MAX_ATTEMPTS/);
    expect(() => validateEnv({ ...ok, SWAGGER_ENABLED: 'yes' })).toThrow(/SWAGGER_ENABLED/);
    expect(() => validateEnv({ ...ok, LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('lists every invalid variable in one error', () =>
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*PUBLIC_API_KEY_PAYMENT/));
});
