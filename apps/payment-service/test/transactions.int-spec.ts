import { ContractValidator } from '@eticket/contract-tests';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import request from 'supertest';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { cardBody, postPayment } from './support/payments';
import { stubPayableOrder } from './support/stubs';

const contract = ContractValidator.load('payment-service');

interface Item {
  transactionId: string;
  paymentReference: string;
  createdAt: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  method: string;
}
interface Page {
  data: Item[];
  page: number;
  pageSize: number;
  total: number;
  code?: string;
}

describe('GET /v1/transactions', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  const created: Array<{ id: string; amountMinor: number; reference: string }> = [];

  const list = (query: string) =>
    request(svc.baseUrl).get(`/v1/transactions${query}`).set('X-Api-Key', svc.publicKey);

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    svc = await startPaymentService(db, { ticket, ledger });
    for (const totalMinor of [10000, 20000, 50000]) {
      const order = stubPayableOrder(ticket, { totalMinor });
      const res = await postPayment(svc, cardBody(order.id));
      expect(res.status).toBe(201);
      created.push({
        id: res.body.id,
        amountMinor: totalMinor,
        reference: res.body.transaction?.paymentReference ?? '',
      });
    }
  });

  afterAll(async () => {
    await svc?.close();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  it('returns the first page newest first with the total', async () => {
    const res = await list('?pageSize=2&page=1');
    expect(res.status).toBe(200);
    contract.assertResponse('listTransactions', 200, res.body);
    const body = res.body as Page;
    expect(body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(body.data).toHaveLength(2);
    expect(body.data.map((i) => i.paymentId)).toEqual([created[2]?.id, created[1]?.id]);
  });

  it('returns the remainder on page 2', async () => {
    const body = (await list('?pageSize=2&page=2')).body as Page;
    expect(body.data.map((i) => i.paymentId)).toEqual([created[0]?.id]);
    expect(body.total).toBe(3);
  });

  it('joins amount, method and reference from the payment', async () => {
    const body = (await list('')).body as Page;
    expect(body).toMatchObject({ page: 1, pageSize: 20 });
    const newest = body.data[0];
    expect(newest).toMatchObject({
      paymentId: created[2]?.id,
      amountMinor: 50000,
      currency: 'AED',
      method: 'CARD',
      paymentReference: created[2]?.reference,
    });
  });

  it.each(['pageSize=101', 'pageSize=0', 'page=0', 'page=abc', 'page=1.5'])(
    'rejects ?%s with 400 VALIDATION_ERROR',
    async (q) => {
      const res = await list(`?${q}`);
      expect(res.status).toBe(400);
      expect((res.body as Page).code).toBe('VALIDATION_ERROR');
    },
  );
});
