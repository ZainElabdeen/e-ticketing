import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import request from 'supertest';
import { startLedgerService, type RunningLedgerService } from './support/app';

describe('health probes and key guard', () => {
  let db: TestDatabase;
  let s: RunningLedgerService;
  let down: RunningLedgerService;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ledger-service');
    s = await startLedgerService(db);
    // Nothing listens on 127.0.0.1:1, so every connection is refused.
    down = await startLedgerService(db, {
      DATABASE_URL: 'postgresql://ledger_app:test-password@127.0.0.1:1/eticketing?schema=ledger',
    });
  });

  afterAll(async () => {
    await down?.close();
    await s?.close();
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

  it('GET /v1/accounts without a key is 401', async () => {
    const r = await request(s.baseUrl).get('/v1/accounts');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('POST /v1/internal/postings with the public key is 403', async () => {
    const r = await request(s.baseUrl)
      .post('/v1/internal/postings')
      .set('X-API-Key', s.publicKey)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});
