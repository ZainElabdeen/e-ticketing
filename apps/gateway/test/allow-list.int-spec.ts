import { startHttpStub, type HttpStub } from '@eticket/testing';
import request from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

const ID = '11111111-1111-4111-8111-111111111111';

describe('allow-list', () => {
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

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) {
      await stub.close();
    }
  });

  const cases: Array<['get' | 'post', string]> = [
    ['get', '/v1/transactions'],
    ['get', '/v1/journal-entries'],
    ['get', '/v1/accounts'],
    ['post', `/v1/internal/orders/${ID}/confirm`],
    ['post', '/v1/internal/postings'],
    ['get', '/v1/internal/x'],
  ];

  it.each(cases)('%s %s is 404 and reaches no downstream', async (method, path) => {
    const r = await request(gw.baseUrl)[method](path);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    for (const stub of Object.values(stubs)) {
      expect(stub.calls).toHaveLength(0);
    }
  });
});
