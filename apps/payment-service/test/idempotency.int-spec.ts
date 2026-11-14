import { randomUUID } from 'node:crypto';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { cardBody, newKey, postPayment, qrBody, validCard } from './support/payments';
import { stubPayableOrder } from './support/stubs';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

describe('Idempotency-Key', () => {
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
    svc = await startPaymentService(db, { ticket, ledger });
    sql = await db.connectAs('payments_app');
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  const payments = async (orderId: string): Promise<number> =>
    Number(
      (
        await sql.query<{ n: string }>(
          `SELECT count(*) AS n FROM payments.payments WHERE order_id = $1`,
          [orderId],
        )
      ).rows[0]?.n,
    );

  describe('key format', () => {
    it.each([
      ['missing', null],
      ['7 characters', 'a'.repeat(7)],
      ['129 characters', 'a'.repeat(129)],
    ])('%s -> 400 VALIDATION_ERROR', async (_label, key) => {
      const order = stubPayableOrder(ticket);
      const res = await postPayment(svc, cardBody(order.id), key);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('8 and 128 characters are accepted', async () => {
      const a = stubPayableOrder(ticket);
      const b = stubPayableOrder(ticket);
      expect((await postPayment(svc, cardBody(a.id), 'k'.repeat(8))).status).toBe(201);
      expect((await postPayment(svc, cardBody(b.id), 'k'.repeat(128))).status).toBe(201);
    });
  });

  it('replay: same key and body -> identical 201 with the replay header, one payment', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const first = await postPayment(svc, cardBody(order.id), key);
    const second = await postPayment(svc, cardBody(order.id), key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await payments(order.id)).toBe(1);
  });

  it('reuse: same key, different body -> 422 IDEMPOTENCY_KEY_REUSE', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    expect((await postPayment(svc, cardBody(order.id), key)).status).toBe(201);
    const res = await postPayment(
      svc,
      cardBody(order.id, validCard({ holder: 'Someone Else' })),
      key,
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSE');
  });

  it('replays the stored 201 after the order has been confirmed (not 409)', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const first = await postPayment(svc, cardBody(order.id), key);
    expect(first.status).toBe(201);

    stubPayableOrder(ticket, { id: order.id, status: 'CONFIRMED' });
    ticket.calls.length = 0;
    const replay = await postPayment(svc, cardBody(order.id), key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(ticket.calls).toHaveLength(0);
  });

  it('a key row with no stored response is never treated as a replay (500, row untouched)', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const body = cardBody(order.id);
    const first = await postPayment(svc, body, key);
    expect(first.status).toBe(201);
    // Same hash as the real request, but the response was never bound.
    await sql.query(
      `UPDATE payments.idempotency_keys SET response_status = NULL, response_body = NULL, payment_id = NULL WHERE key = $1`,
      [key],
    );
    const res = await postPayment(svc, body, key);
    expect(res.status).toBe(500);
    const row = await sql.query<{ response_status: number | null }>(
      `SELECT response_status FROM payments.idempotency_keys WHERE key = $1`,
      [key],
    );
    expect(row.rows[0]?.response_status).toBeNull();
  });

  it('a QR replay after success returns the original PENDING body', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const first = await postPayment(svc, qrBody(order.id), key);
    expect(first.body.status).toBe('PENDING');

    // The QR job arrives later; flip the payment by SQL.
    await sql.query(
      `UPDATE payments.payments SET status = 'SUCCEEDED', succeeded_at = now() WHERE id = $1`,
      [first.body.id],
    );
    const replay = await postPayment(svc, qrBody(order.id), key);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.body.status).toBe('PENDING');
  });

  describe('a failure does not bind the key', () => {
    it('Luhn-invalid card -> 422, then the same key with a valid card -> 201', async () => {
      const order = stubPayableOrder(ticket);
      const key = newKey();
      const bad = await postPayment(
        svc,
        cardBody(order.id, validCard({ number: '4242424242424241' })),
        key,
      );
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('INVALID_CARD');
      const good = await postPayment(svc, cardBody(order.id), key);
      expect(good.status).toBe(201);
      expect(good.headers['idempotent-replayed']).toBeUndefined();
    });

    it('unknown order -> 404, then the same key with a payable order -> 201', async () => {
      const unknown = randomUUID();
      ticket.on('GET', new RegExp(`^/v1/orders/${unknown}$`), {
        status: 404,
        body: { statusCode: 404, code: 'ORDER_NOT_FOUND', message: 'x', correlationId: 'c' },
      });
      const key = newKey();
      expect((await postPayment(svc, cardBody(unknown), key)).status).toBe(404);
      const order = stubPayableOrder(ticket);
      const res = await postPayment(svc, cardBody(order.id), key);
      expect(res.status).toBe(201);
    });

    it('a 409 for a paid order does not bind the key either', async () => {
      const order = stubPayableOrder(ticket);
      expect((await postPayment(svc, cardBody(order.id))).status).toBe(201);
      const key = newKey();
      expect((await postPayment(svc, qrBody(order.id), key)).status).toBe(409);
      const rows = await sql.query(`SELECT 1 FROM payments.idempotency_keys WHERE key = $1`, [key]);
      expect(rows.rowCount).toBe(0);
    });
  });

  it('5 parallel identical requests: all 201 and equal, one payment, four replays', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postPayment(svc, cardBody(order.id), key)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    for (const r of results) expect(r.body).toEqual(results[0]!.body);
    expect(results.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(4);
    expect(await payments(order.id)).toBe(1);
  });

  describe('replay wins over the card-expiry check', () => {
    it('a retry after the card month ends replays the 201; a new key is 422 INVALID_CARD', async () => {
      const real = new Date();
      const month = real.getUTCMonth() + 1;
      const year = real.getUTCFullYear();
      let current = real;
      const clocked = await startPaymentService(
        db,
        { ticket, ledger },
        {},
        { clock: { now: () => current } },
      );
      try {
        const order = stubPayableOrder(ticket);
        const body = cardBody(order.id, validCard({ expMonth: month, expYear: year }));
        const key = newKey();
        const first = await postPayment(clocked, body, key);
        expect(first.status).toBe(201);

        current = new Date(Date.UTC(year, month, 1, 0, 1)); // first minute of the next month
        const replay = await postPayment(clocked, body, key);
        expect(replay.status).toBe(201);
        expect(replay.headers['idempotent-replayed']).toBe('true');
        expect(replay.body).toEqual(first.body);

        const fresh = await postPayment(clocked, body, newKey());
        expect(fresh.status).toBe(422);
        expect(fresh.body.code).toBe('INVALID_CARD');
      } finally {
        await clocked.close();
      }
    });
  });
});
