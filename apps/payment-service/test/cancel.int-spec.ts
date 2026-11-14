import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { cardBody, postPayment, qrBody, newKey } from './support/payments';
import { stubPayableOrder } from './support/stubs';

describe('POST /v1/payments/:id/cancel', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    svc = await startPaymentService(db, { ticket, ledger });
  });

  afterAll(async () => {
    await svc?.close();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  const cancel = (id: string) =>
    request(svc.baseUrl).post(`/v1/payments/${id}/cancel`).set('X-Api-Key', svc.publicKey);

  it('cancels a PENDING QR payment', async () => {
    const order = stubPayableOrder(ticket);
    const created = await postPayment(svc, qrBody(order.id));
    const res = await cancel(created.body.id);
    expect(res.status).toBe(200);
    const body = res.body as { status: string; cancelledAt: string | null };
    expect(body.status).toBe('CANCELLED');
    expect(body.cancelledAt).toEqual(expect.any(String));
  });

  it('cancelling twice -> 409 PAYMENT_NOT_CANCELLABLE', async () => {
    const order = stubPayableOrder(ticket);
    const created = await postPayment(svc, qrBody(order.id));
    await cancel(created.body.id);
    const res = await cancel(created.body.id);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('PAYMENT_NOT_CANCELLABLE');
  });

  it('a SUCCEEDED card payment -> 409', async () => {
    const order = stubPayableOrder(ticket);
    const created = await postPayment(svc, cardBody(order.id));
    const res = await cancel(created.body.id);
    expect(res.status).toBe(409);
    expect((res.body as { code: string }).code).toBe('PAYMENT_NOT_CANCELLABLE');
  });

  it('an unknown payment -> 404 NOT_FOUND', async () => {
    const res = await cancel(randomUUID());
    expect(res.status).toBe(404);
    expect((res.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('a non-UUID id -> 400', async () => {
    expect((await cancel('nope')).status).toBe(400);
  });

  it('after a cancel, a new card payment for the same order is accepted', async () => {
    const order = stubPayableOrder(ticket);
    const qr = await postPayment(svc, qrBody(order.id));
    expect((await cancel(qr.body.id)).status).toBe(200);
    const card = await postPayment(svc, cardBody(order.id), newKey());
    expect(card.status).toBe(201);
    expect(card.body.status).toBe('SUCCEEDED');
  });
});
