import { randomUUID } from 'node:crypto';
import { ContractValidator } from '@eticket/contract-tests';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { cardBody, getPayment, newKey, postPayment, qrBody, validCard } from './support/payments';
import { stubPayableOrder } from './support/stubs';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

const contract = ContractValidator.load('payment-service');
const REFERENCE = /^PAY-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{6}$/;

describe('POST /v1/payments and GET /v1/payments/:id', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  let sql: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    svc = await startPaymentService(db, { ticket, ledger }, { DOWNSTREAM_TIMEOUT_MS: '300' });
    sql = await db.connectAs('payments_app');
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  const count = async (table: string, where = 'true'): Promise<number> =>
    Number(
      (await sql.query<{ n: string }>(`SELECT count(*) AS n FROM payments.${table} WHERE ${where}`))
        .rows[0]?.n,
    );

  it('card success: 201 SUCCEEDED, amount from the order, one transaction, one outbox event', async () => {
    const order = stubPayableOrder(ticket, { totalMinor: 31337 });
    const res = await postPayment(svc, cardBody(order.id));

    expect(res.status).toBe(201);
    contract.assertResponse('createPayment', 201, res.body);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(res.body).toMatchObject({
      orderId: order.id,
      method: 'CARD',
      status: 'SUCCEEDED',
      amountMinor: 31337,
      currency: 'AED',
      cardLast4: '4242',
      qrPayload: null,
      cancelledAt: null,
    });
    expect(res.body.transaction?.paymentReference).toMatch(REFERENCE);
    expect(res.body.succeededAt).not.toBeNull();

    const tx = await sql.query<{ id: string; payment_reference: string; created_at: Date }>(
      `SELECT t.id, t.payment_reference, t.created_at FROM payments.transactions t WHERE t.payment_id = $1`,
      [res.body.id],
    );
    expect(tx.rows).toHaveLength(1);
    expect(tx.rows[0]?.id).toBe(res.body.transaction?.transactionId);

    const outbox = await sql.query<{
      status: string;
      type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT status, type, payload FROM payments.outbox_events WHERE payload->>'paymentId' = $1`,
      [res.body.id],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({ status: 'PENDING', type: 'payment.succeeded' });
    const payload = outbox.rows[0]?.payload;
    ContractValidator.validateEvent('payment-succeeded', payload);
    expect(payload).toMatchObject({
      transactionId: tx.rows[0]?.id,
      paymentId: res.body.id,
      orderId: order.id,
      paymentReference: tx.rows[0]?.payment_reference,
      amountMinor: 31337,
      currency: 'AED',
      occurredAt: tx.rows[0]?.created_at.toISOString(),
    });
  });

  it('ignores a client-supplied amount (the DTO forbids extra fields)', async () => {
    const order = stubPayableOrder(ticket);
    const res = await postPayment(svc, { ...cardBody(order.id), amountMinor: 1 });
    expect(res.status).toBe(400);
  });

  it('forwards the correlation id to the Ticket Service', async () => {
    const order = stubPayableOrder(ticket);
    ticket.calls.length = 0;
    const cid = randomUUID();
    await postPayment(svc, cardBody(order.id), newKey(), { 'X-Correlation-Id': cid });
    expect(ticket.calls[0]?.headers['x-correlation-id']).toBe(cid);
    const outbox = await sql.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM payments.outbox_events WHERE payload->>'orderId' = $1`,
      [order.id],
    );
    expect(outbox.rows[0]?.payload.correlationId).toBe(cid);
  });

  it('QR: 201 PENDING with a payload, no transaction, succeed_after about 8 s out', async () => {
    const order = stubPayableOrder(ticket);
    const res = await postPayment(svc, qrBody(order.id));

    expect(res.status).toBe(201);
    contract.assertResponse('createPayment', 201, res.body);
    expect(res.body).toMatchObject({
      method: 'QR',
      status: 'PENDING',
      qrPayload: `eticket:pay:${res.body.id}`,
      cardLast4: null,
      succeededAt: null,
    });
    expect(res.body.transaction).toBeUndefined();

    const row = await sql.query<{ delta: string }>(
      `SELECT extract(epoch FROM succeed_after - created_at) AS delta FROM payments.payments WHERE id = $1`,
      [res.body.id],
    );
    const delta = Number(row.rows[0]?.delta);
    expect(delta).toBeGreaterThan(7);
    expect(delta).toBeLessThan(9);
    expect(await count('transactions', `payment_id = '${res.body.id}'`)).toBe(0);
    expect(await count('outbox_events', `payload->>'paymentId' = '${res.body.id}'`)).toBe(0);
  });

  describe('order checks', () => {
    it('unknown order -> 404 ORDER_NOT_FOUND', async () => {
      const id = randomUUID();
      ticket.on('GET', new RegExp(`^/v1/orders/${id}$`), {
        status: 404,
        body: { statusCode: 404, code: 'ORDER_NOT_FOUND', message: 'x', correlationId: 'c' },
      });
      const res = await postPayment(svc, cardBody(id));
      expect(res.status).toBe(404);
      contract.assertResponse('createPayment', 404, res.body);
      expect(res.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('CONFIRMED order -> 409 ORDER_NOT_PAYABLE', async () => {
      const order = stubPayableOrder(ticket, { status: 'CONFIRMED' });
      const res = await postPayment(svc, cardBody(order.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('PENDING order that has expired -> 409 ORDER_NOT_PAYABLE', async () => {
      const order = stubPayableOrder(ticket, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      const res = await postPayment(svc, cardBody(order.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ORDER_NOT_PAYABLE');
    });
  });

  describe('upstream failures do not bind the key', () => {
    it('Ticket Service drops the connection -> 502, then the retry succeeds', async () => {
      const order = stubPayableOrder(ticket);
      const key = newKey();
      ticket.on('GET', new RegExp(`^/v1/orders/${order.id}$`), 'drop');
      const failed = await postPayment(svc, cardBody(order.id), key);
      expect(failed.status).toBe(502);
      contract.assertResponse('createPayment', 502, failed.body);
      expect(failed.body.code).toBe('UPSTREAM_UNAVAILABLE');

      stubPayableOrder(ticket, { id: order.id });
      const retry = await postPayment(svc, cardBody(order.id), key);
      expect(retry.status).toBe(201);
      expect(retry.headers['idempotent-replayed']).toBeUndefined();
    });

    it('Ticket Service is slow -> 504, then the retry succeeds', async () => {
      const order = stubPayableOrder(ticket);
      const key = newKey();
      ticket.on('GET', new RegExp(`^/v1/orders/${order.id}$`), { status: 200, delayMs: 3000 });
      const failed = await postPayment(svc, cardBody(order.id), key);
      expect(failed.status).toBe(504);
      contract.assertResponse('createPayment', 504, failed.body);
      expect(failed.body.code).toBe('UPSTREAM_TIMEOUT');

      stubPayableOrder(ticket, { id: order.id });
      const retry = await postPayment(svc, cardBody(order.id), key);
      expect(retry.status).toBe(201);
    });
  });

  describe('one live payment per order', () => {
    it('QR then card -> 409 PAYMENT_IN_PROGRESS', async () => {
      const order = stubPayableOrder(ticket);
      expect((await postPayment(svc, qrBody(order.id))).status).toBe(201);
      const second = await postPayment(svc, cardBody(order.id));
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('PAYMENT_IN_PROGRESS');
    });

    it('card then QR -> 409 ORDER_ALREADY_PAID', async () => {
      const order = stubPayableOrder(ticket);
      expect((await postPayment(svc, cardBody(order.id))).status).toBe(201);
      const second = await postPayment(svc, qrBody(order.id));
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ORDER_ALREADY_PAID');
    });

    it('6 concurrent card requests with different keys: one 201, five 409, one payment', async () => {
      const order = stubPayableOrder(ticket);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => postPayment(svc, cardBody(order.id))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.code).toBe('ORDER_ALREADY_PAID');
      }
      expect(await count('payments', `order_id = '${order.id}'`)).toBe(1);
      expect(await count('outbox_events', `payload->>'orderId' = '${order.id}'`)).toBe(1);
    });
  });

  describe('read', () => {
    it('GET returns the same body as the create response', async () => {
      const order = stubPayableOrder(ticket);
      const created = await postPayment(svc, cardBody(order.id));
      const res = await getPayment(svc, created.body.id);
      expect(res.status).toBe(200);
      contract.assertResponse('getPayment', 200, res.body);
      expect(res.body).toEqual(created.body);
    });

    it('GET of a PENDING QR payment has no transaction', async () => {
      const order = stubPayableOrder(ticket);
      const created = await postPayment(svc, qrBody(order.id));
      const res = await getPayment(svc, created.body.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(created.body);
    });

    it('unknown payment -> 404 NOT_FOUND', async () => {
      const res = await getPayment(svc, randomUUID());
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });

    it('non-UUID -> 400', async () => {
      const res = await getPayment(svc, 'not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  it('expired card -> 422 INVALID_CARD before any order lookup', async () => {
    ticket.calls.length = 0;
    const res = await postPayment(svc, cardBody(randomUUID(), validCard({ expYear: 2000 })));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_CARD');
    expect(ticket.calls).toHaveLength(0);
  });
});
