import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import request from 'supertest';
import { startTicketService, type RunningService } from './support/app';

describe('/docs', () => {
  let db: TestDatabase;
  let on: RunningService;
  let off: RunningService;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ticket-service');
    on = await startTicketService(db, { SWAGGER_ENABLED: 'true' });
    off = await startTicketService(db);
  });

  afterAll(async () => {
    await off?.close();
    await on?.close();
    await db?.stop();
  });

  it('serves the swagger UI without a key when enabled', async () => {
    const r = await request(on.baseUrl).get('/docs');
    expect(r.status).toBe(200);
    expect(r.text).toContain('swagger');
  });

  it('is not served when disabled', async () => {
    const r = await request(off.baseUrl).get('/docs');
    expect(r.status).toBe(401);
  });
});
