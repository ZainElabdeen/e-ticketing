import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import request from 'supertest';
import { startPaymentService, type RunningPaymentService } from './support/app';

describe('health probes', () => {
  let db: TestDatabase;
  let s: RunningPaymentService;
  let down: RunningPaymentService;
  let stubs: { ticket: HttpStub; ledger: HttpStub };

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    stubs = { ticket: await startHttpStub(), ledger: await startHttpStub() };
    s = await startPaymentService(db, stubs);
    // Nothing listens on 127.0.0.1:1, so every connection is refused.
    down = await startPaymentService(db, stubs, {
      DATABASE_URL:
        'postgresql://payments_app:test-password@127.0.0.1:1/eticketing?schema=payments',
    });
  });

  afterAll(async () => {
    await down?.close();
    await s?.close();
    await stubs?.ticket.close();
    await stubs?.ledger.close();
    await db?.stop();
  });

  it('live is 200 without a key', async () => {
    const r = await request(s.baseUrl).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('ready is 200 with the DB up', async () => {
    const r = await request(s.baseUrl).get('/health/ready');
    expect(r.status).toBe(200);
    expect((r.body as { status: string }).status).toBe('ok');
  });

  it('ready is 503 within 3 s when the DB is gone, live stays 200', async () => {
    const t0 = Date.now();
    const r = await request(down.baseUrl).get('/health/ready');
    expect(r.status).toBe(503);
    expect((r.body as { status: string }).status).toBe('error');
    expect(Date.now() - t0).toBeLessThan(3000);
    expect((await request(down.baseUrl).get('/health/live')).status).toBe(200);
  });

  it('GET /v1/transactions without a key is 401', async () => {
    const r = await request(s.baseUrl).get('/v1/transactions');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });
});
