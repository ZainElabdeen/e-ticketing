import { randomBytes } from 'node:crypto';
import { startHttpStub, type HttpStub } from '@eticket/testing';
import { JwtService } from '@nestjs/jwt';
import request, { type Response } from 'supertest';
import { PUBLIC_KEYS, startGateway, type RunningGateway } from './support/app';

const bodyOf = (r: Response) => r.body as Record<string, string>;

describe('backoffice routes', () => {
  let stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };
  let gw: RunningGateway;
  let secret: string;
  let token: string;

  const sign = (opts: { secret?: string; expiresIn?: number; issuer?: string } = {}) =>
    new JwtService().sign(
      { sub: 'admin@example.com' },
      {
        secret: opts.secret ?? secret,
        algorithm: 'HS256',
        expiresIn: opts.expiresIn ?? 3600,
        issuer: opts.issuer ?? 'e-ticketing-gateway',
      },
    );
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const totalCalls = () =>
    stubs.ticket.calls.length + stubs.payment.calls.length + stubs.ledger.calls.length;

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
    secret = randomBytes(48).toString('hex');
    gw = await startGateway(stubs, { JWT_SECRET: secret });
    token = sign();
  });

  beforeEach(() => {
    for (const stub of Object.values(stubs)) {
      stub.reset();
    }
  });

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) {
      await stub.close();
    }
  });

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  describe('mapping', () => {
    it('GET transactions -> payment /v1/transactions with only page and pageSize', async () => {
      stubs.payment.on('GET', /^\/v1\/transactions/, { status: 200, body: { items: [] } });
      const r = await request(gw.baseUrl)
        .get('/v1/backoffice/transactions?page=2&pageSize=5&x=1')
        .set(auth());
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ items: [] });
      const call = stubs.payment.calls[0]!;
      expect(call.path).toBe('/v1/transactions?page=2&pageSize=5');
      expect(call.headers['x-api-key']).toBe(PUBLIC_KEYS.payment);
      expect(call.headers['authorization']).toBeUndefined();
    });

    it('GET ledger-entries -> ledger /v1/journal-entries', async () => {
      stubs.ledger.on('GET', /^\/v1\/journal-entries/, { status: 200, body: { items: [] } });
      const r = await request(gw.baseUrl)
        .get('/v1/backoffice/ledger-entries?page=1&pageSize=abc')
        .set(auth());
      expect(r.status).toBe(200);
      expect(stubs.ledger.calls[0]!.path).toBe('/v1/journal-entries?page=1&pageSize=abc');
      expect(stubs.ledger.calls[0]!.headers['x-api-key']).toBe(PUBLIC_KEYS.ledger);
    });

    it('GET accounts -> ledger /v1/accounts, query dropped', async () => {
      stubs.ledger.on('GET', /^\/v1\/accounts/, { status: 200, body: [] });
      const r = await request(gw.baseUrl).get('/v1/backoffice/accounts?page=3').set(auth());
      expect(r.status).toBe(200);
      expect(stubs.ledger.calls[0]!.path).toBe('/v1/accounts');
    });

    it('GET ticket-availability -> ticket /v1/ticket-types', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types/, { status: 200, body: [] });
      const r = await request(gw.baseUrl).get('/v1/backoffice/ticket-availability').set(auth());
      expect(r.status).toBe(200);
      expect(stubs.ticket.calls[0]!.path).toBe('/v1/ticket-types');
      expect(stubs.ticket.calls[0]!.headers['x-api-key']).toBe(PUBLIC_KEYS.ticket);
    });

    it('passes a downstream 400 through', async () => {
      const envelope = {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'bad',
        correlationId: 'c',
      };
      stubs.payment.on('GET', /^\/v1\/transactions/, { status: 400, body: envelope });
      const r = await request(gw.baseUrl).get('/v1/backoffice/transactions?page=0').set(auth());
      expect(r.status).toBe(400);
      expect(r.body).toEqual(envelope);
    });
  });

  describe('JWT bypass matrix', () => {
    const noneToken = () =>
      `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
        sub: 'admin@example.com',
        iss: 'e-ticketing-gateway',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`;

    const cases: Array<[string, () => { path?: string; header?: string }]> = [
      ['no header', () => ({})],
      ['empty bearer token', () => ({ header: 'Bearer ' })],
      ['lowercase bearer', () => ({ header: `bearer ${token}` })],
      ['two spaces', () => ({ header: `Bearer  ${token}` })],
      ['other secret', () => ({ header: `Bearer ${sign({ secret: 'x'.repeat(40) })}` })],
      ['expired', () => ({ header: `Bearer ${sign({ expiresIn: -10 })}` })],
      ['wrong issuer', () => ({ header: `Bearer ${sign({ issuer: 'someone-else' })}` })],
      ['alg none', () => ({ header: `Bearer ${noneToken()}` })],
      ['token in query', () => ({ path: `?access_token=${token}` })],
    ];

    it.each(cases)('rejects %s with 401 UNAUTHORIZED and no downstream call', async (_n, build) => {
      const { path = '', header } = build();
      let req = request(gw.baseUrl).get(`/v1/backoffice/accounts${path}`);
      if (header !== undefined) {
        req = req.set('Authorization', header);
      }
      const r = await req;
      expect(r.status).toBe(401);
      expect(bodyOf(r).code).toBe('UNAUTHORIZED');
      expect(totalCalls()).toBe(0);
    });
  });
});
