import { Writable } from 'node:stream';
import { startHttpStub, type HttpStub } from '@eticket/testing';
import { JwtService } from '@nestjs/jwt';
import request, { type Response } from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

const bodyOf = (r: Response) => r.body as Record<string, unknown>;

describe('POST /v1/auth/login', () => {
  let stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };
  let gw: RunningGateway;
  const lines: string[] = [];

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
    const logStream = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    gw = await startGateway(stubs, { LOG_LEVEL: 'info' }, { logStream });
  });

  beforeEach(() => {
    lines.length = 0;
  });

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) {
      await stub.close();
    }
  });

  const login = (body: unknown) =>
    request(gw.baseUrl)
      .post('/v1/auth/login')
      .send(body as object);
  const auditLines = () =>
    lines
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l['event'] === 'auth.login');

  it('issues an HS256 token with sub, iss and a one hour lifetime', async () => {
    const r = await login({ email: gw.adminEmail, password: gw.adminPassword });
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('expiresIn', 3600);
    const [header] = (bodyOf(r).accessToken as string).split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({
      alg: 'HS256',
    });
    const claims = new JwtService().decode<Record<string, number | string>>(
      bodyOf(r).accessToken as string,
    );
    expect(claims['sub']).toBe(gw.adminEmail);
    expect(claims['iss']).toBe('e-ticketing-gateway');
    expect((claims['exp'] as number) - (claims['iat'] as number)).toBe(3600);
  });

  it('accepts a differently cased, padded email', async () => {
    const r = await login({
      email: `  ${gw.adminEmail.toUpperCase()} `,
      password: gw.adminPassword,
    });
    expect(r.status).toBe(200);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrongPassword = await login({ email: gw.adminEmail, password: 'wrong-password-1' });
    const unknownEmail = await login({ email: 'nobody@example.com', password: gw.adminPassword });
    for (const r of [wrongPassword, unknownEmail]) {
      expect(r.status).toBe(401);
      expect(bodyOf(r).code).toBe('INVALID_CREDENTIALS');
    }
    expect(bodyOf(wrongPassword).message).toBe(bodyOf(unknownEmail).message);
  });

  it.each([
    ['missing password', { email: 'admin@example.com' }],
    ['missing email', { password: 'long-enough-pw' }],
    ['7 char password', { email: 'admin@example.com', password: '1234567' }],
    ['129 char password', { email: 'admin@example.com', password: 'a'.repeat(129) }],
    ['73 byte password', { email: 'admin@example.com', password: 'é'.repeat(37) }],
    ['extra field', { email: 'admin@example.com', password: 'long-enough-pw', role: 'x' }],
    ['non-email', { email: 'not-an-email', password: 'long-enough-pw' }],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_name, body) => {
    const r = await login(body);
    expect(r.status).toBe(400);
    expect(bodyOf(r).code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed JSON', async () => {
    const r = await request(gw.baseUrl)
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(r.status).toBe(400);
    expect(bodyOf(r).message).toBe('Malformed JSON body');
  });

  it('never logs the password', async () => {
    const password = 'distinctive-pw-Zq7x!';
    await login({ email: gw.adminEmail, password });
    expect(lines.join('')).not.toContain(password);
  });

  describe('audit log', () => {
    it('writes one success line with no secrets', async () => {
      const r = await login({ email: gw.adminEmail, password: gw.adminPassword });
      const audit = auditLines();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        msg: 'login attempt',
        level: 'info',
        outcome: 'success',
        emailMatched: true,
      });
      expect(audit[0]!['correlationId']).toBe(r.headers['x-correlation-id']);
      expect(audit[0]!['ip']).toEqual(expect.any(String));
      const all = lines.join('');
      expect(all).not.toContain(gw.adminEmail);
      expect(all).not.toContain(gw.adminPassword);
      expect(all).not.toContain(bodyOf(r).accessToken as string);
    });

    it('writes a warn line for a wrong password', async () => {
      await login({ email: gw.adminEmail, password: 'wrong-password-1' });
      const audit = auditLines();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        level: 'warn',
        outcome: 'invalid_credentials',
        emailMatched: true,
      });
      expect(lines.join('')).not.toContain(gw.adminEmail);
    });

    it('records emailMatched false for an unknown email without logging it', async () => {
      await login({ email: 'probe-person@example.com', password: gw.adminPassword });
      const audit = auditLines();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ outcome: 'invalid_credentials', emailMatched: false });
      const all = lines.join('');
      expect(all).not.toContain('probe-person');
      expect(all).not.toContain(gw.adminPassword);
    });
  });
});
