import { randomUUID } from 'node:crypto';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

const REQUEST_HASH = 'a'.repeat(64);

describe('payments schema', () => {
  let db: TestDatabase;
  let app: Client;

  const insertPayment = async (orderId: string, status: string, method = 'QR'): Promise<string> => {
    const id = randomUUID();
    await app.query(
      `INSERT INTO payments.payments (id, order_id, method, status, amount_minor)
       VALUES ($1, $2, $3, $4, 10000)`,
      [id, orderId, method, status],
    );
    return id;
  };

  const insertTransaction = (paymentId: string, reference = `PAY-20261113-${randomUUID()}`) =>
    app.query(`INSERT INTO payments.transactions (payment_id, payment_reference) VALUES ($1, $2)`, [
      paymentId,
      reference,
    ]);

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    app = await db.connectAs('payments_app');
  });

  afterAll(async () => {
    await app.end();
    await db.stop();
  });

  it('allows only one PENDING or SUCCEEDED payment per order', async () => {
    const pendingOrder = randomUUID();
    await insertPayment(pendingOrder, 'PENDING');
    await expect(insertPayment(pendingOrder, 'PENDING')).rejects.toMatchObject({ code: '23505' });

    const paidOrder = randomUUID();
    await insertPayment(paidOrder, 'SUCCEEDED');
    await expect(insertPayment(paidOrder, 'PENDING')).rejects.toMatchObject({ code: '23505' });
  });

  it('frees the order after cancellation', async () => {
    const orderId = randomUUID();
    const paymentId = await insertPayment(orderId, 'PENDING');

    await app.query(
      `UPDATE payments.payments SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1`,
      [paymentId],
    );

    await expect(insertPayment(orderId, 'PENDING')).resolves.toBeTruthy();
  });

  it('rejects payment statuses outside PENDING/SUCCEEDED/CANCELLED', async () => {
    await expect(insertPayment(randomUUID(), 'FAILED')).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects non-positive amounts and unknown methods', async () => {
    await expect(
      app.query(
        `INSERT INTO payments.payments (order_id, method, status, amount_minor)
         VALUES ($1, 'QR', 'PENDING', 0)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(insertPayment(randomUUID(), 'PENDING', 'CRYPTO')).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('keeps one transaction per payment and unique references', async () => {
    const paymentId = await insertPayment(randomUUID(), 'SUCCEEDED');
    const reference = `PAY-20261113-${randomUUID()}`;

    await insertTransaction(paymentId, reference);
    await expect(insertTransaction(paymentId, reference)).rejects.toMatchObject({ code: '23505' });

    const otherPayment = await insertPayment(randomUUID(), 'SUCCEEDED');
    await expect(insertTransaction(otherPayment, reference)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('requires idempotency response status and body together', async () => {
    await expect(
      app.query(
        `INSERT INTO payments.idempotency_keys (key, request_hash, response_status)
         VALUES ($1, $2, 201)`,
        [randomUUID(), REQUEST_HASH],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      app.query(`INSERT INTO payments.idempotency_keys (key, request_hash) VALUES ($1, $2)`, [
        randomUUID(),
        REQUEST_HASH,
      ]),
    ).resolves.toBeTruthy();

    await expect(
      app.query(
        `INSERT INTO payments.idempotency_keys (key, request_hash, response_status, response_body)
         VALUES ($1, $2, 201, $3::jsonb)`,
        [randomUUID(), REQUEST_HASH, JSON.stringify({ id: randomUUID() })],
      ),
    ).resolves.toBeTruthy();
  });

  it('rejects outbox statuses outside PENDING/DONE/FAILED', async () => {
    await expect(
      app.query(
        `INSERT INTO payments.outbox_events (type, payload, status)
         VALUES ('payment.succeeded', '{}'::jsonb, 'PROCESSING')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects unknown confirm outcomes', async () => {
    await expect(
      app.query(
        `INSERT INTO payments.outbox_events (type, payload, confirm_outcome)
         VALUES ('payment.succeeded', '{}'::jsonb, 'MAYBE')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('denies payments_app access to the ledger schema', async () => {
    await expect(app.query('SELECT 1 FROM ledger.accounts')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
