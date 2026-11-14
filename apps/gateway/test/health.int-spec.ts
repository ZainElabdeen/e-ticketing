import { startHttpStub, type HttpStub } from '@eticket/testing';
import request from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

describe('health and edge', () => {
  let stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };
  let gw: RunningGateway;

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
    gw = await startGateway(stubs);
  });

  beforeEach(() => {
    for (const stub of Object.values(stubs)) {
      stub.reset();
      stub.on('GET', /^\/health\/live$/, { status: 200, body: { status: 'ok' } });
    }
  });

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) {
      await stub.close();
    }
  });

  it('live is 200 and calls no downstream', async () => {
    const r = await request(gw.baseUrl).get('/health/live');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
    expect(stubs.ticket.calls).toHaveLength(0);
  });

  it('ready is 200 when all three answer, sending no API key', async () => {
    const r = await request(gw.baseUrl).get('/health/ready');
    expect(r.status).toBe(200);
    for (const stub of Object.values(stubs)) {
      expect(stub.calls).toHaveLength(1);
      expect(stub.calls[0]!.path).toBe('/health/live');
      expect(stub.calls[0]!.headers['x-api-key']).toBeUndefined();
    }
  });

  it('ready is 503 within 3 s when one downstream is gone, naming it', async () => {
    stubs.payment.on('GET', /^\/health\/live$/, 'drop');
    const t0 = Date.now();
    const r = await request(gw.baseUrl).get('/health/ready');
    expect(r.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(3000);
    const body = r.body as { status: string; details: Record<string, { status: string }> };
    expect(body.status).toBe('error');
    expect(body.details['payment-service']?.status).toBe('down');
    expect(body.details['ticket-service']?.status).toBe('up');
  });

  it('an unknown path is a 404 NOT_FOUND envelope', async () => {
    const r = await request(gw.baseUrl).get('/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });

  it('does not allow a foreign origin', async () => {
    const r = await request(gw.baseUrl).get('/health/live').set('Origin', 'http://evil.example');
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes the configured origin and exposes the agreed headers', async () => {
    const r = await request(gw.baseUrl).get('/health/live').set('Origin', 'http://localhost:5173');
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(r.headers['access-control-allow-credentials']).toBeUndefined();
    expect(r.headers['access-control-expose-headers']).toBe(
      'X-Correlation-Id,Idempotent-Replayed,Retry-After',
    );
  });

  it('answers the preflight with the allowed methods and headers', async () => {
    const r = await request(gw.baseUrl)
      .options('/v1/orders')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(r.status).toBe(204);
    expect(r.headers['access-control-allow-methods']).toBe('GET,POST,OPTIONS');
    expect(r.headers['access-control-allow-headers']).toBe(
      'Content-Type,Authorization,Idempotency-Key,X-Correlation-Id',
    );
  });

  it('sets helmet headers', async () => {
    const r = await request(gw.baseUrl).get('/health/live');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});
