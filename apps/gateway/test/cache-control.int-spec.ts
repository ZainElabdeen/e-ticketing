import { startHttpStub, type HttpStub } from '@eticket/testing';
import request from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

describe('Cache-Control on sensitive routes', () => {
  let stub: HttpStub;
  let gw: RunningGateway;

  beforeAll(async () => {
    stub = await startHttpStub();
    gw = await startGateway({ ticket: stub, payment: stub, ledger: stub });
  });

  afterAll(async () => {
    await gw?.close();
    await stub?.close();
  });

  it('login responses, success and failure, are no-store', async () => {
    const ok = await request(gw.baseUrl)
      .post('/v1/auth/login')
      .send({ email: gw.adminEmail, password: gw.adminPassword });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const bad = await request(gw.baseUrl)
      .post('/v1/auth/login')
      .send({ email: gw.adminEmail, password: 'wrong-password-123' });
    expect(bad.status).toBe(401);
    expect(bad.headers['cache-control']).toBe('no-store');
  });

  it('backoffice responses are no-store, including the 401 and the relayed body', async () => {
    const denied = await request(gw.baseUrl).get('/v1/backoffice/accounts');
    expect(denied.status).toBe(401);
    expect(denied.headers['cache-control']).toBe('no-store');

    const login = await request(gw.baseUrl)
      .post('/v1/auth/login')
      .send({ email: gw.adminEmail, password: gw.adminPassword });
    const token = (login.body as { accessToken: string }).accessToken;
    stub.on('GET', /^\/v1\/accounts/, { status: 200, body: { data: [], totals: {} } });
    const ok = await request(gw.baseUrl)
      .get('/v1/backoffice/accounts')
      .set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('does not add no-store to public shop routes', async () => {
    stub.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: { data: [] } });
    const r = await request(gw.baseUrl).get('/v1/ticket-types');
    expect(r.headers['cache-control']).toBeUndefined();
  });
});
