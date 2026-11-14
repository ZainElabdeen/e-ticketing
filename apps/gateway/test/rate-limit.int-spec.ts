import { startHttpStub, type HttpStub } from '@eticket/testing';
import request, { type Response } from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

type Stubs = { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };

describe('rate limiting', () => {
  let stubs: Stubs;
  const running: RunningGateway[] = [];

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
  });

  beforeEach(() => {
    for (const stub of Object.values(stubs)) {
      stub.reset();
      stub.on('GET', /^\/health\/live$/, { status: 200, body: { status: 'ok' } });
    }
    stubs.ticket.on('POST', /^\/v1\/orders$/, { status: 201, body: { id: 'o1' } });
    stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: [] });
  });

  afterAll(async () => {
    for (const gw of running) await gw.close();
    for (const stub of Object.values(stubs ?? {})) await stub.close();
  });

  async function boot(overrides: Record<string, string>): Promise<RunningGateway> {
    const gw = await startGateway(stubs, overrides);
    running.push(gw);
    return gw;
  }

  const order = (gw: RunningGateway, xff?: string) => {
    const r = request(gw.baseUrl).post('/v1/orders').send({ items: [] });
    return xff ? r.set('X-Forwarded-For', xff) : r;
  };
  const types = (gw: RunningGateway, xff?: string) => {
    const r = request(gw.baseUrl).get('/v1/ticket-types');
    return xff ? r.set('X-Forwarded-For', xff) : r;
  };
  const expectLimited = (r: Response) => {
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    const retry = Number(r.headers['retry-after']);
    expect(Number.isInteger(retry)).toBe(true);
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
  };

  it('limits POST /v1/orders to RATE_LIMIT_ORDERS_PER_MIN', async () => {
    const gw = await boot({ RATE_LIMIT_ORDERS_PER_MIN: '2' });
    expect((await order(gw)).status).toBe(201);
    expect((await order(gw)).status).toBe(201);
    expectLimited(await order(gw));
    expect(stubs.ticket.calls.filter((c) => c.path === '/v1/orders')).toHaveLength(2);
  });

  it('limits login to RATE_LIMIT_LOGIN_PER_MIN, even with correct credentials', async () => {
    const gw = await boot({ RATE_LIMIT_LOGIN_PER_MIN: '2' });
    const body = { email: gw.adminEmail, password: gw.adminPassword };
    expect((await request(gw.baseUrl).post('/v1/auth/login').send(body)).status).toBe(200);
    expect((await request(gw.baseUrl).post('/v1/auth/login').send(body)).status).toBe(200);
    expectLimited(await request(gw.baseUrl).post('/v1/auth/login').send(body));
  });

  it('applies RATE_LIMIT_DEFAULT_PER_MIN to other routes', async () => {
    const gw = await boot({ RATE_LIMIT_DEFAULT_PER_MIN: '3' });
    for (let i = 0; i < 3; i++) expect((await types(gw)).status).toBe(200);
    expectLimited(await types(gw));
  });

  it('never limits health', async () => {
    const gw = await boot({ RATE_LIMIT_DEFAULT_PER_MIN: '1' });
    for (let i = 0; i < 10; i++) {
      expect((await request(gw.baseUrl).get('/health/live')).status).toBe(200);
    }
    for (let i = 0; i < 3; i++) {
      expect((await request(gw.baseUrl).get('/health/ready')).status).toBe(200);
    }
  });

  it('keeps per-route budgets independent', async () => {
    const gw = await boot({ RATE_LIMIT_ORDERS_PER_MIN: '1', RATE_LIMIT_DEFAULT_PER_MIN: '2' });
    expect((await order(gw)).status).toBe(201);
    expect((await order(gw)).status).toBe(429);
    expect((await types(gw)).status).toBe(200);
    expect((await types(gw)).status).toBe(200);
    expect((await types(gw)).status).toBe(429);
  });

  it('TRUST_PROXY=0: a spoofed X-Forwarded-For cannot reset the counter', async () => {
    const gw = await boot({ TRUST_PROXY: '0', RATE_LIMIT_DEFAULT_PER_MIN: '2' });
    expect((await types(gw, '10.0.0.1')).status).toBe(200);
    expect((await types(gw, '10.0.0.2')).status).toBe(200);
    expectLimited(await types(gw, '10.0.0.3'));
  });

  it('TRUST_PROXY=1: each forwarded client IP gets its own budget', async () => {
    const gw = await boot({ TRUST_PROXY: '1', RATE_LIMIT_DEFAULT_PER_MIN: '2' });
    for (let i = 0; i < 2; i++) expect((await types(gw, '10.0.0.1')).status).toBe(200);
    expectLimited(await types(gw, '10.0.0.1'));
    for (let i = 0; i < 2; i++) expect((await types(gw, '10.0.0.2')).status).toBe(200);
    expectLimited(await types(gw, '10.0.0.2'));
  });
});
