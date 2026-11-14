import { Writable } from 'node:stream';
import { startHttpStub, type HttpStub } from '@eticket/testing';
import request from 'supertest';
import { PUBLIC_KEYS, startGateway, type RunningGateway } from './support/app';

const ID = '11111111-1111-4111-8111-111111111111';

// A downstream 401 or 403 means the gateway's own key is wrong: that is our
// misconfiguration, not the caller's, so it must not reach the client as a 4xx.
describe('downstream rejects the gateway key', () => {
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
    for (const stub of Object.values(stubs)) stub.reset();
  });

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) await stub.close();
  });

  it.each([401, 403])(
    'maps a downstream %i to 502 UPSTREAM_UNAVAILABLE and warns',
    async (status) => {
      stubs.ticket.on('GET', /^\/v1\/orders\//, {
        status,
        body: { statusCode: status, code: 'UNAUTHORIZED', message: 'x', correlationId: 'c' },
      });
      const r = await request(gw.baseUrl).get(`/v1/orders/${ID}`);
      expect(r.status).toBe(502);
      expect(r.body).toMatchObject({ statusCode: 502, code: 'UPSTREAM_UNAVAILABLE' });
      expect(JSON.stringify(r.body)).not.toContain('UNAUTHORIZED');

      const warn = lines
        .map((l) => JSON.parse(l) as Record<string, unknown>)
        .find((l) => l.level === 'warn' && l.downstreamStatus === status);
      expect(warn).toMatchObject({ downstreamService: 'ticket-service' });
      expect(lines.join('')).not.toContain(PUBLIC_KEYS.ticket);
    },
  );

  it('still passes other 4xx through', async () => {
    const envelope = { statusCode: 404, code: 'ORDER_NOT_FOUND', message: 'x', correlationId: 'c' };
    stubs.ticket.on('GET', /^\/v1\/orders\//, { status: 404, body: envelope });
    const r = await request(gw.baseUrl).get(`/v1/orders/${ID}`);
    expect(r.status).toBe(404);
    expect(r.body).toEqual(envelope);
  });
});
