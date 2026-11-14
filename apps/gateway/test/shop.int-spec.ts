import { startHttpStub, type HttpStub } from '@eticket/testing';
import { request as rawRequest } from 'node:http';
import request from 'supertest';
import { PUBLIC_KEYS, startGateway, type RunningGateway } from './support/app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('shop routes', () => {
  let stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };
  let gw: RunningGateway;

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
    gw = await startGateway(stubs, { DOWNSTREAM_TIMEOUT_MS: '300' });
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

  describe('ticket routes', () => {
    it('GET /v1/ticket-types relays the body and injects key and correlation id', async () => {
      const body = [{ id: 'gold', priceMinor: 10000 }];
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body });
      const r = await request(gw.baseUrl).get('/v1/ticket-types');
      expect(r.status).toBe(200);
      expect(r.body).toEqual(body);
      const call = stubs.ticket.calls[0]!;
      expect(call.headers['x-api-key']).toBe(PUBLIC_KEYS.ticket);
      expect(call.headers['x-correlation-id']).toBe(r.headers['x-correlation-id']);
    });

    it('POST /v1/orders forwards the body and returns 201', async () => {
      stubs.ticket.on('POST', /^\/v1\/orders$/, { status: 201, body: { id: ID } });
      const payload = { items: [{ ticketTypeId: 'gold', quantity: 2 }] };
      const r = await request(gw.baseUrl).post('/v1/orders').send(payload);
      expect(r.status).toBe(201);
      expect(stubs.ticket.calls[0]!.body).toEqual(payload);
      expect(stubs.ticket.calls[0]!.headers['content-type']).toContain('application/json');
    });

    it('passes a downstream 409 envelope through deep-equal', async () => {
      const envelope = {
        statusCode: 409,
        code: 'QUOTA_EXCEEDED',
        message: 'not enough',
        correlationId: 'c',
      };
      stubs.ticket.on('POST', /^\/v1\/orders$/, { status: 409, body: envelope });
      const r = await request(gw.baseUrl).post('/v1/orders').send({});
      expect(r.status).toBe(409);
      expect(r.body).toEqual(envelope);
    });

    it('refuses a path param that decodes to a separator without calling downstream', async () => {
      stubs.ticket.on('GET', /^\/v1\/orders\//, { status: 200, body: {} });
      const r = await request(gw.baseUrl).get('/v1/orders/abc%2F..%2Fx');
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(stubs.ticket.calls).toHaveLength(0);
    });

    it('encodes path params it does forward', async () => {
      stubs.ticket.on('GET', /^\/v1\/orders\//, { status: 404, body: { code: 'NOT_FOUND' } });
      await request(gw.baseUrl).get('/v1/orders/a%20b%3Fx');
      expect(stubs.ticket.calls[0]!.path).toBe('/v1/orders/a%20b%3Fx');
    });

    it('GET /v1/orders/:id passes through', async () => {
      stubs.ticket.on('GET', new RegExp(`^/v1/orders/${ID}$`), { status: 200, body: { id: ID } });
      const r = await request(gw.baseUrl).get(`/v1/orders/${ID}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id: ID });
    });
  });

  describe('payment routes', () => {
    it('forwards Idempotency-Key and the replay header', async () => {
      stubs.payment.on('POST', /^\/v1\/payments$/, {
        status: 200,
        body: { id: ID },
        headers: { 'Idempotent-Replayed': 'true' },
      });
      const r = await request(gw.baseUrl)
        .post('/v1/payments')
        .set('Idempotency-Key', 'k-123456789')
        .send({ orderId: ID, method: 'card' });
      expect(r.status).toBe(200);
      expect(r.headers['idempotent-replayed']).toBe('true');
      const call = stubs.payment.calls[0]!;
      expect(call.headers['idempotency-key']).toBe('k-123456789');
      expect(call.headers['x-api-key']).toBe(PUBLIC_KEYS.payment);
      expect(call.body).toEqual({ orderId: ID, method: 'card' });
    });

    it('passes a 422 IDEMPOTENCY_KEY_REUSE through', async () => {
      const envelope = { statusCode: 422, code: 'IDEMPOTENCY_KEY_REUSE', message: 'm' };
      stubs.payment.on('POST', /^\/v1\/payments$/, { status: 422, body: envelope });
      const r = await request(gw.baseUrl).post('/v1/payments').send({});
      expect(r.status).toBe(422);
      expect(r.body).toEqual(envelope);
    });

    it('GET and cancel pass through', async () => {
      stubs.payment.on('GET', new RegExp(`^/v1/payments/${ID}$`), {
        status: 200,
        body: { status: 'PENDING' },
      });
      stubs.payment.on('POST', new RegExp(`^/v1/payments/${ID}/cancel$`), {
        status: 200,
        body: { status: 'CANCELLED' },
      });
      const g = await request(gw.baseUrl).get(`/v1/payments/${ID}`);
      expect(g.body).toEqual({ status: 'PENDING' });
      const c = await request(gw.baseUrl).post(`/v1/payments/${ID}/cancel`).send({});
      expect(c.status).toBe(200);
      expect(c.body).toEqual({ status: 'CANCELLED' });
    });
  });

  describe('header hygiene', () => {
    it('never forwards client credentials downstream', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: [] });
      await request(gw.baseUrl)
        .get('/v1/ticket-types')
        .set('Authorization', 'Bearer x')
        .set('X-Api-Key', 'client-key')
        .set('Cookie', 'a=b')
        .set('X-Forwarded-For', '1.2.3.4')
        .set('X-Forwarded-Host', 'evil.example')
        .set('X-Forwarded-Proto', 'https')
        .set('Host', 'evil.example');
      const h = stubs.ticket.calls[0]!.headers;
      expect(h['authorization']).toBeUndefined();
      expect(h['cookie']).toBeUndefined();
      expect(h['x-forwarded-for']).toBeUndefined();
      expect(h['x-forwarded-host']).toBeUndefined();
      expect(h['x-forwarded-proto']).toBeUndefined();
      expect(h['host']).not.toBe('evil.example');
      expect(h['x-api-key']).toBe(PUBLIC_KEYS.ticket);
    });

    it('does not send an Idempotency-Key the client did not send', async () => {
      stubs.payment.on('POST', /^\/v1\/payments$/, { status: 200, body: {} });
      await request(gw.baseUrl).post('/v1/payments').send({});
      expect(stubs.payment.calls[0]!.headers['idempotency-key']).toBeUndefined();
    });

    it('never forwards downstream Set-Cookie or X-Api-Key to the client', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, {
        status: 200,
        body: [],
        headers: { 'Set-Cookie': 'sid=1', 'X-Api-Key': 'secret-downstream' },
      });
      const r = await request(gw.baseUrl).get('/v1/ticket-types');
      expect(r.headers['set-cookie']).toBeUndefined();
      expect(r.headers['x-api-key']).toBeUndefined();
      expect(r.headers['idempotent-replayed']).toBeUndefined();
    });
  });

  describe('failures', () => {
    const expectEnvelope = (r: request.Response, status: number, code: string): void => {
      expect(r.status).toBe(status);
      expect(r.body).toMatchObject({ statusCode: status, code });
      expect((r.body as { correlationId: string }).correlationId).toBe(
        r.headers['x-correlation-id'],
      );
      expect(JSON.stringify(r.body)).not.toContain('127.0.0.1');
      expect(JSON.stringify(r.body)).not.toContain(PUBLIC_KEYS.ticket);
    };

    it('a dropped connection is 502 UPSTREAM_UNAVAILABLE', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, 'drop');
      expectEnvelope(
        await request(gw.baseUrl).get('/v1/ticket-types'),
        502,
        'UPSTREAM_UNAVAILABLE',
      );
    });

    it('a slow downstream is 504 UPSTREAM_TIMEOUT', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: [], delayMs: 1500 });
      expectEnvelope(await request(gw.baseUrl).get('/v1/ticket-types'), 504, 'UPSTREAM_TIMEOUT');
    });

    it('a non-JSON 200 is 502', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, {
        status: 200,
        body: '<html>nope</html>',
        headers: { 'content-type': 'text/html' },
      });
      expectEnvelope(
        await request(gw.baseUrl).get('/v1/ticket-types'),
        502,
        'UPSTREAM_UNAVAILABLE',
      );
    });

    it('a 302 is 502', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, {
        status: 302,
        headers: { location: 'http://evil.example/' },
      });
      expectEnvelope(
        await request(gw.baseUrl).get('/v1/ticket-types'),
        502,
        'UPSTREAM_UNAVAILABLE',
      );
    });

    it('a downstream 500 JSON envelope passes through', async () => {
      const envelope = { statusCode: 500, code: 'INTERNAL_ERROR', message: 'x' };
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 500, body: envelope });
      const r = await request(gw.baseUrl).get('/v1/ticket-types');
      expect(r.status).toBe(500);
      expect(r.body).toEqual(envelope);
    });
  });

  describe('dot-segment path params', () => {
    const raw = (method: string, path: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const url = new URL(gw.baseUrl);
        // http.request sends the path as given, unlike supertest/axios which may normalise it.
        const req = rawRequest(
          { host: url.hostname, port: url.port, method, path, headers: { 'content-length': '0' } },
          (res) => {
            let body = '';
            res.on('data', (c: Buffer) => (body += c.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          },
        );
        req.on('error', reject);
        req.end();
      });

    it.each([
      ['GET', '/v1/orders/..'],
      ['GET', '/v1/orders/.'],
      ['GET', '/v1/payments/..'],
      ['POST', '/v1/payments/../cancel'],
      ['POST', '/v1/payments/%2E%2E/cancel'],
      ['POST', '/v1/payments/./cancel'],
    ])('%s %s never leaves the mapped route', async (method, path) => {
      for (const stub of [stubs.ticket, stubs.payment]) {
        stub.on('GET', /.*/, { status: 200, body: {} });
        stub.on('POST', /.*/, { status: 200, body: {} });
      }
      const r = await raw(method, path);
      const calls = [...stubs.ticket.calls, ...stubs.payment.calls];
      for (const call of calls) {
        expect(['/v1/', '/v1/cancel', '/v1/payments/cancel']).not.toContain(call.path);
        expect(call.path).toMatch(/^\/v1\/(orders|payments)\/(%2E|[^./])/);
      }
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body)).toMatchObject({ code: 'NOT_FOUND' });
      expect(calls).toHaveLength(0);
    });
  });

  describe('query and CORS', () => {
    it('drops the query string', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: [] });
      await request(gw.baseUrl).get('/v1/ticket-types?evil=1');
      expect(stubs.ticket.calls[0]!.path).toBe('/v1/ticket-types');
    });

    it('does not allow a foreign origin on a shop route', async () => {
      stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: [] });
      const r = await request(gw.baseUrl)
        .get('/v1/ticket-types')
        .set('Origin', 'http://evil.example');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
