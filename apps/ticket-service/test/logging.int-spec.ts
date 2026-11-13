import { Writable } from 'node:stream';
import request from 'supertest';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService;
const lines: string[] = [];

beforeAll(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ticket-service');
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      done();
    },
  });
  service = await startTicketService(db, { LOG_LEVEL: 'info' }, { logStream: sink });
});

afterAll(async () => {
  await service?.close();
  await db?.stop();
});

describe('request logging', () => {
  it('emits the spec fields and never the API key', async () => {
    const res = await request(service.baseUrl)
      .get('/v1/ticket-types?x=1')
      .set('X-Api-Key', service.publicKey)
      .set('X-Correlation-Id', '0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    const entry = entries.find((e) => e.route === '/v1/ticket-types');
    expect(entry).toBeDefined();
    expect(entry).toEqual(
      expect.objectContaining({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) as unknown,
        level: 'info',
        service: 'ticket-service',
        correlationId: expect.any(String) as unknown,
        method: 'GET',
        route: '/v1/ticket-types',
        statusCode: 200,
        durationMs: expect.any(Number) as unknown,
      }),
    );
    expect(typeof entry?.durationMs).toBe('number');
    expect(lines.join('\n')).not.toContain(service.publicKey);
  });
});
