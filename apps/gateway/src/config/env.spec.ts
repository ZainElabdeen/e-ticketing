import bcrypt from 'bcryptjs';
import { validateEnv } from './env';

const hash = bcrypt.hashSync('correct-horse-battery', 12);

function validEnv(): Record<string, string> {
  return {
    TICKET_SERVICE_URL: 'http://ticket:3001',
    PAYMENT_SERVICE_URL: 'http://payment:3002',
    LEDGER_SERVICE_URL: 'http://ledger:3003',
    PUBLIC_API_KEY_TICKET: 't'.repeat(32),
    PUBLIC_API_KEY_PAYMENT: 'p'.repeat(32),
    PUBLIC_API_KEY_LEDGER: 'l'.repeat(32),
    JWT_SECRET: 'j'.repeat(32),
    ADMIN_EMAIL: 'admin@example.com',
    ADMIN_PASSWORD_HASH_B64: Buffer.from(hash).toString('base64'),
    WEB_ORIGIN: 'http://localhost:5173',
  };
}

describe('validateEnv', () => {
  it('applies every default', () => {
    const env = validateEnv(validEnv());
    expect(env).toMatchObject({
      PORT: 3000,
      SWAGGER_ENABLED: false,
      LOG_LEVEL: 'info',
      DOWNSTREAM_TIMEOUT_MS: 5000,
      TRUST_PROXY: 0,
      RATE_LIMIT_DEFAULT_PER_MIN: 100,
      RATE_LIMIT_ORDERS_PER_MIN: 5,
      RATE_LIMIT_LOGIN_PER_MIN: 10,
    });
  });

  it('parses overrides from strings', () => {
    const env = validateEnv({
      ...validEnv(),
      PORT: '4000',
      SWAGGER_ENABLED: 'true',
      TRUST_PROXY: '2',
      RATE_LIMIT_ORDERS_PER_MIN: '9',
    });
    expect(env).toMatchObject({
      PORT: 4000,
      SWAGGER_ENABLED: true,
      TRUST_PROXY: 2,
      RATE_LIMIT_ORDERS_PER_MIN: 9,
    });
  });

  it.each(Object.keys(validEnv()))('names %s when it is missing', (name) => {
    const raw = validEnv();
    delete raw[name];
    expect(() => validateEnv(raw)).toThrow(new RegExp(name));
  });

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...validEnv(), JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('rejects a WEB_ORIGIN that is not a URL', () => {
    expect(() => validateEnv({ ...validEnv(), WEB_ORIGIN: 'localhost' })).toThrow(/WEB_ORIGIN/);
  });

  it.each([
    ['TRUST_PROXY', '6'],
    ['DOWNSTREAM_TIMEOUT_MS', '50'],
    ['RATE_LIMIT_DEFAULT_PER_MIN', '0'],
    ['ADMIN_EMAIL', 'nope'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => validateEnv({ ...validEnv(), [name]: value })).toThrow(new RegExp(name));
  });

  it('rejects an admin hash with cost 10 without echoing it', () => {
    const bad = Buffer.from(bcrypt.hashSync('correct-horse-battery', 10)).toString('base64');
    let message = '';
    try {
      validateEnv({ ...validEnv(), ADMIN_PASSWORD_HASH_B64: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ADMIN_PASSWORD_HASH_B64/);
    expect(message).not.toContain(bad);
  });

  it('lists every invalid variable in one error', () => {
    const raw = { ...validEnv(), JWT_SECRET: 'x', WEB_ORIGIN: 'y', ADMIN_PASSWORD_HASH_B64: 'z' };
    expect(() => validateEnv(raw)).toThrow(
      /JWT_SECRET[\s\S]*ADMIN_PASSWORD_HASH_B64[\s\S]*WEB_ORIGIN/,
    );
  });
});

describe('validateEnv unrelated keys', () => {
  it('drops variables that are not gateway settings', () => {
    const env = validateEnv({ ...validEnv(), AWS_SECRET_ACCESS_KEY: 'leak-me', HOME: '/root' });
    expect(Object.keys(env)).not.toContain('AWS_SECRET_ACCESS_KEY');
    expect(Object.keys(env)).not.toContain('HOME');
    expect(env.TICKET_SERVICE_URL).toBe('http://ticket:3001');
  });

  describe('placeholder secrets', () => {
    it.each([
      'JWT_SECRET',
      'PUBLIC_API_KEY_TICKET',
      'PUBLIC_API_KEY_PAYMENT',
      'PUBLIC_API_KEY_LEDGER',
    ])('rejects a placeholder %s (case-insensitive) without echoing it', (name) => {
      for (const value of [
        'replace-with-openssl-rand-hex-32-xxxxxxxx',
        'CHANGE-ME-ticket-public-key-at-least-32',
      ]) {
        let message = '';
        try {
          validateEnv({ ...validEnv(), [name]: value });
        } catch (error) {
          message = (error as Error).message;
        }
        expect(message).toContain(`${name} is still a placeholder`);
        expect(message).not.toContain(value);
      }
    });

    it('accepts a real-looking secret', () => {
      expect(() => validateEnv({ ...validEnv(), JWT_SECRET: 'a1'.repeat(32) })).not.toThrow();
    });
  });
});
