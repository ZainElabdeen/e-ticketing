import request from 'supertest';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService;

beforeAll(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ticket-service');
  service = await startTicketService(db);
});

afterAll(async () => {
  await service?.close();
  await db?.stop();
});

describe('body-parser errors', () => {
  it('returns a 413 PAYLOAD_TOO_LARGE envelope for a body over 100 KB', async () => {
    const res = await request(service.baseUrl)
      .post('/v1/orders')
      .set('X-Api-Key', service.publicKey)
      .send({ items: [{ ticketTypeCode: 'GOLD', quantity: 1 }], pad: 'x'.repeat(150 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
    expect((res.body as { correlationId: string }).correlationId).toEqual(expect.any(String));
  });
});
