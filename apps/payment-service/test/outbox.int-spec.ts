import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { PrismaService } from '../src/common/prisma.service';
import { OutboxRepository } from '../src/outbox/outbox.repository';
import { OutboxWorker } from '../src/outbox/outbox.worker';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { cardBody, postPayment } from './support/payments';
import { stubPayableOrder } from './support/stubs';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

interface EventRow {
  id: string;
  status: string;
  attempts: number;
  confirm_outcome: string | null;
  last_error: string | null;
  processed_at: Date | null;
  secs_until_next: number;
}

const CORRELATION = '7d1c5e4a-2b3f-4c6d-8e9a-0b1c2d3e4f5a';
const CONFIRM = /^\/v1\/internal\/orders\/[^/]+\/confirm$/;
const POSTINGS = /^\/v1\/internal\/postings$/;
const ok = { status: 200, body: {} };
const created = { status: 201, body: {} };
const fail = { status: 500, body: { message: 'boom' } };

describe('OutboxWorker', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  let sql: Client;
  let worker: OutboxWorker;

  async function boot(overrides: Record<string, string> = {}): Promise<void> {
    await svc?.close();
    svc = await startPaymentService(db, { ticket, ledger }, overrides);
    worker = svc.app.get(OutboxWorker);
  }

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    sql = await db.connectAs('payments_app');
    await boot();
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  beforeEach(async () => {
    // Park leftovers so each test only sees its own events.
    await sql.query(
      `UPDATE payments.outbox_events SET status = 'DONE', processed_at = now() WHERE status = 'PENDING'`,
    );
    ticket.reset();
    ledger.reset();
  });

  /** Makes a real card payment, which writes a real outbox event. */
  async function seed(
    correlationId?: string,
  ): Promise<{ orderId: string; totalMinor: number; eventId: string }> {
    const order = stubPayableOrder(ticket);
    const res = await postPayment(
      svc,
      cardBody(order.id),
      undefined,
      correlationId ? { 'X-Correlation-Id': correlationId } : {},
    );
    expect(res.status).toBe(201);
    const ev = await sql.query<{ id: string }>(
      `SELECT id FROM payments.outbox_events WHERE payload->>'orderId' = $1`,
      [order.id],
    );
    return { orderId: order.id, totalMinor: order.totalMinor, eventId: ev.rows[0]?.id ?? '' };
  }

  async function row(id: string): Promise<EventRow> {
    const r = await sql.query<EventRow>(
      `SELECT id, status, attempts, confirm_outcome, last_error, processed_at,
              extract(epoch FROM (next_attempt_at - now()))::float8 AS secs_until_next
       FROM payments.outbox_events WHERE id = $1`,
      [id],
    );
    return r.rows[0] as EventRow;
  }

  const makeDue = (id: string) =>
    sql.query(`UPDATE payments.outbox_events SET next_attempt_at = now() WHERE id = $1`, [id]);

  const header = (call: { headers: Record<string, unknown> }) => call.headers['x-correlation-id'];

  it('confirms then posts TICKET_SALE, forwarding the payment correlation id', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, created);
    const { orderId, totalMinor, eventId } = await seed(CORRELATION);
    ticket.calls.length = 0;

    expect(await worker.runOnce()).toBe(1);

    const e = await row(eventId);
    expect(e).toMatchObject({ status: 'DONE', confirm_outcome: 'CONFIRMED', attempts: 0 });
    expect(e.processed_at).not.toBeNull();
    expect(ticket.calls).toHaveLength(1);
    expect(ticket.calls[0]?.path).toBe(`/v1/internal/orders/${orderId}/confirm`);
    const tx = await sql.query<{ id: string; payment_reference: string }>(
      `SELECT t.id, t.payment_reference FROM payments.transactions t
       JOIN payments.payments p ON p.id = t.payment_id WHERE p.order_id = $1`,
      [orderId],
    );
    expect(ticket.calls[0]?.body).toEqual({ transactionId: tx.rows[0]?.id });
    expect(ledger.calls).toHaveLength(1);
    expect(ledger.calls[0]?.body).toMatchObject({
      postingType: 'TICKET_SALE',
      orderId,
      amountMinor: totalMinor,
      currency: 'AED',
      paymentReference: tx.rows[0]?.payment_reference,
      transactionId: tx.rows[0]?.id,
    });
    expect(header(ticket.calls[0]!)).toBe(CORRELATION);
    expect(header(ledger.calls[0]!)).toBe(CORRELATION);
  });

  it('falls back to the event id (a UUID) when the payload has no correlation id', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, created);
    const { eventId } = await seed();
    await sql.query(
      `UPDATE payments.outbox_events SET payload = payload - 'correlationId' WHERE id = $1`,
      [eventId],
    );
    ticket.calls.length = 0;
    expect(await worker.runOnce()).toBe(1);
    expect(eventId).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(header(ticket.calls[0]!)).toBe(eventId);
    expect(header(ledger.calls[0]!)).toBe(eventId);
  });

  it('posts UNFULFILLED_PAYMENT when the order is not confirmable', async () => {
    ticket.on('POST', CONFIRM, {
      status: 409,
      body: { statusCode: 409, code: 'ORDER_NOT_CONFIRMABLE', message: 'x', correlationId: 'c' },
    });
    ledger.on('POST', POSTINGS, created);
    const { eventId } = await seed();
    expect(await worker.runOnce()).toBe(1);
    expect(await row(eventId)).toMatchObject({
      status: 'DONE',
      confirm_outcome: 'NOT_CONFIRMABLE',
    });
    expect(ledger.calls[0]?.body).toMatchObject({ postingType: 'UNFULFILLED_PAYMENT' });
  });

  it('keeps the confirm outcome across a ledger failure and never confirms twice', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, fail);
    const { eventId } = await seed();
    ticket.calls.length = 0;

    expect(await worker.runOnce()).toBe(1);
    const first = await row(eventId);
    expect(first).toMatchObject({ status: 'PENDING', attempts: 1, confirm_outcome: 'CONFIRMED' });
    expect(first.last_error).toBeTruthy();
    expect(first.secs_until_next).toBeGreaterThan(0.5);
    expect(first.secs_until_next).toBeLessThanOrEqual(2.1);

    await makeDue(eventId);
    ledger.on('POST', POSTINGS, created);
    expect(await worker.runOnce()).toBe(1);
    expect(await row(eventId)).toMatchObject({ status: 'DONE', confirm_outcome: 'CONFIRMED' });
    expect(ticket.calls).toHaveLength(1);
  });

  it('backs off exponentially, then FAILs at OUTBOX_MAX_ATTEMPTS', async () => {
    await boot({ OUTBOX_MAX_ATTEMPTS: '3' });
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, fail);
    const { eventId } = await seed();

    await worker.runOnce();
    expect(await row(eventId)).toMatchObject({ status: 'PENDING', attempts: 1 });
    await makeDue(eventId);
    await worker.runOnce();
    const second = await row(eventId);
    expect(second).toMatchObject({ status: 'PENDING', attempts: 2 });
    expect(second.secs_until_next).toBeGreaterThan(2.5);
    expect(second.secs_until_next).toBeLessThanOrEqual(4.1);
    await makeDue(eventId);
    await worker.runOnce();
    const third = await row(eventId);
    expect(third).toMatchObject({ status: 'FAILED', attempts: 3 });
    expect(third.processed_at).not.toBeNull();
    expect(third.last_error).toBeTruthy();
    await makeDue(eventId);
    expect(await worker.runOnce()).toBe(0);
    await boot();
  });

  it('retries a confirm transport failure with the outcome still null', async () => {
    ticket.on('POST', CONFIRM, 'drop');
    ledger.on('POST', POSTINGS, created);
    const { eventId } = await seed();
    ticket.calls.length = 0;

    expect(await worker.runOnce()).toBe(1);
    expect(await row(eventId)).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      confirm_outcome: null,
    });
    expect(ledger.calls).toHaveLength(0);

    await makeDue(eventId);
    ticket.on('POST', CONFIRM, ok);
    expect(await worker.runOnce()).toBe(1);
    expect(ticket.calls).toHaveLength(2);
    expect(await row(eventId)).toMatchObject({ status: 'DONE', confirm_outcome: 'CONFIRMED' });
  });

  it('stops the batch and recovers when processing an event throws', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, created);
    const { eventId } = await seed();
    const repo = svc.app.get(OutboxRepository);
    const spy = jest.spyOn(repo, 'processOne').mockRejectedValueOnce(new Error('tx timeout'));
    expect(await worker.runOnce()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await row(eventId)).status).toBe('PENDING');
    spy.mockRestore();
    expect(await worker.runOnce()).toBe(1);
    expect((await row(eventId)).status).toBe('DONE');
  });

  describe('ledger breaker (per batch)', () => {
    const SKIPPED = 'ledger skipped: unavailable earlier in this batch';

    it('calls the ledger once per batch, still confirms every event, and recovers next run', async () => {
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, 'drop');
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) ids.push((await seed()).eventId);
      ticket.calls.length = 0;

      expect(await worker.runOnce()).toBe(5);
      expect(ledger.calls).toHaveLength(1);
      expect(ticket.calls).toHaveLength(5);
      const rows = await Promise.all(ids.map(row));
      for (const r of rows) {
        expect(r).toMatchObject({ status: 'PENDING', attempts: 1, confirm_outcome: 'CONFIRMED' });
      }
      expect(rows.filter((r) => r.last_error?.startsWith('ledger skipped'))).toHaveLength(4);
      expect(rows.filter((r) => r.last_error === SKIPPED)).toHaveLength(4);

      ledger.reset();
      ledger.on('POST', POSTINGS, created);
      ticket.calls.length = 0;
      await Promise.all(ids.map(makeDue));
      expect(await worker.runOnce()).toBe(5);
      expect((await Promise.all(ids.map(row))).every((r) => r.status === 'DONE')).toBe(true);
      expect(ledger.calls).toHaveLength(5);
      expect(ticket.calls).toHaveLength(0);
    });

    it('does not trip on a 4xx: the 409 event is retried alone and the others finish in the same run', async () => {
      ticket.on('POST', CONFIRM, ok);
      const conflict = {
        status: 409,
        body: { statusCode: 409, code: 'POSTING_CONFLICT', message: 'x', correlationId: 'c' },
      };
      let n = 0;
      ledger.on('POST', POSTINGS, () => (n++ === 0 ? conflict : created));
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) ids.push((await seed()).eventId);

      expect(await worker.runOnce()).toBe(4);
      expect(ledger.calls).toHaveLength(4);
      const rows = await Promise.all(ids.map(row));
      expect(rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(rows[0]?.last_error).not.toBe(SKIPPED);
      for (const r of rows.slice(1)) expect(r).toMatchObject({ status: 'DONE' });
    });

    it('trips on a 5xx like on an outage', async () => {
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, { status: 503, body: {} });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await seed()).eventId);
      expect(await worker.runOnce()).toBe(3);
      expect(ledger.calls).toHaveLength(1);
      const rows = await Promise.all(ids.map(row));
      expect(rows.filter((r) => r.last_error === SKIPPED)).toHaveLength(2);
    });

    it('makes only one timed-out ledger call when failures are slow', async () => {
      await boot({ DOWNSTREAM_TIMEOUT_MS: '300' });
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, { status: 201, body: {}, delayMs: 2000 });
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) ids.push((await seed()).eventId);

      const t0 = Date.now();
      expect(await worker.runOnce()).toBe(3);
      expect(Date.now() - t0).toBeLessThan(900);
      expect(ledger.calls).toHaveLength(1);
      const rows = await Promise.all(ids.map(row));
      expect(rows.every((r) => r.status === 'PENDING' && r.attempts === 1)).toBe(true);
      await boot();
    });

    it('counts skipped events toward FAILED like real failures', async () => {
      await boot({ OUTBOX_MAX_ATTEMPTS: '1' });
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, 'drop');
      const a = await seed();
      const b = await seed();
      expect(await worker.runOnce()).toBe(2);
      expect(ledger.calls).toHaveLength(1);
      expect(await row(a.eventId)).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(await row(b.eventId)).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        last_error: SKIPPED,
      });
      await boot();
    });
  });

  describe('attempt counting when processing throws after the claim', () => {
    it('records an attempt in a separate transaction, then FAILs at the max', async () => {
      await boot({ OUTBOX_MAX_ATTEMPTS: '2' });
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, created);
      const { eventId } = await seed();
      // Test seam: the handler runs inside the claiming transaction, so a throwing
      // handler stands in for a DB error or a transaction timeout after the claim.
      const worker2 = worker as unknown as { deliver: (e: unknown) => Promise<unknown> };
      const spy = jest.spyOn(worker2, 'deliver').mockRejectedValue(new Error('db exploded'));

      expect(await worker.runOnce()).toBe(0);
      const first = await row(eventId);
      expect(first).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(first.last_error).toContain('db exploded');
      expect(first.secs_until_next).toBeGreaterThan(0.5);

      await makeDue(eventId);
      expect(await worker.runOnce()).toBe(0);
      const second = await row(eventId);
      expect(second).toMatchObject({ status: 'FAILED', attempts: 2 });
      expect(second.processed_at).not.toBeNull();

      spy.mockRestore();
      await boot();
    });

    it('does nothing extra when the throw happens before any claim', async () => {
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, created);
      const { eventId } = await seed();
      const prisma = svc.app.get(PrismaService);
      const spy = jest
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('cannot connect'));
      expect(await worker.runOnce()).toBe(0);
      spy.mockRestore();
      expect(await row(eventId)).toMatchObject({ status: 'PENDING', attempts: 0 });
    });
  });

  describe('recordFailedAttempt guards', () => {
    it('does not touch or log FAILED for an event that is no longer PENDING', async () => {
      await boot({ OUTBOX_MAX_ATTEMPTS: '1' });
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, created);
      const { eventId } = await seed();
      await sql.query(
        `UPDATE payments.outbox_events SET status = 'DONE', processed_at = now() WHERE id = $1`,
        [eventId],
      );
      const repo = svc.app.get(OutboxRepository);
      const logger = (repo as unknown as { logger: Logger }).logger;
      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
      await (
        repo as unknown as {
          recordFailedAttempt: (id: string, e: unknown, o: string | null) => Promise<void>;
        }
      ).recordFailedAttempt(eventId, new Error('late'), null);
      expect(await row(eventId)).toMatchObject({ status: 'DONE', attempts: 0, last_error: null });
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      await boot();
    });

    it('keeps the confirm outcome when the claiming transaction rolls back after the ledger call', async () => {
      ticket.on('POST', CONFIRM, ok);
      ledger.on('POST', POSTINGS, created);
      const { eventId } = await seed();
      ticket.calls.length = 0;
      const prisma = svc.app.get(PrismaService);
      const realTx = prisma.$transaction.bind(prisma) as (
        fn: (tx: Record<string, unknown>) => Promise<unknown>,
        opts: unknown,
      ) => Promise<unknown>;
      // Fails the final status UPDATE, so the transaction rolls back after confirm and post.
      const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce(((
        fn: (tx: Record<string, unknown>) => Promise<unknown>,
        opts: unknown,
      ) =>
        realTx(
          (tx) =>
            fn(
              new Proxy(tx, {
                get(target, prop) {
                  if (prop === '$executeRaw') {
                    return () => Promise.reject(new Error('done update failed'));
                  }
                  const v = target[prop as string];
                  return typeof v === 'function' ? (v as () => unknown).bind(target) : v;
                },
              }),
            ),
          opts,
        )) as never);

      expect(await worker.runOnce()).toBe(0);
      spy.mockRestore();
      expect(ticket.calls).toHaveLength(1);
      expect(await row(eventId)).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        confirm_outcome: 'CONFIRMED',
      });

      await makeDue(eventId);
      expect(await worker.runOnce()).toBe(1);
      expect(ticket.calls).toHaveLength(1);
      expect(await row(eventId)).toMatchObject({ status: 'DONE', confirm_outcome: 'CONFIRMED' });
    });
  });

  it('processes events in created_at order within one batch', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, created);
    const a = await seed();
    const b = await seed();
    const c = await seed();
    ticket.calls.length = 0;
    expect(await worker.runOnce()).toBe(3);
    expect(ticket.calls.map((x) => x.path)).toEqual(
      [a, b, c].map((s) => `/v1/internal/orders/${s.orderId}/confirm`),
    );
  });

  it('two parallel runs process each event exactly once', async () => {
    ticket.on('POST', CONFIRM, ok);
    ledger.on('POST', POSTINGS, created);
    for (let i = 0; i < 5; i++) await seed();
    ledger.calls.length = 0;

    const [x, y] = await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(x + y).toBe(5);
    const ids = ledger.calls.map((c) => (c.body as { transactionId: string }).transactionId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
  });

  it('registers the interval when enabled and removes it on close', async () => {
    const other = await startPaymentService(
      db,
      { ticket, ledger },
      { OUTBOX_ENABLED: 'true', OUTBOX_INTERVAL_SECONDS: '1' },
    );
    const registry = other.app.get(SchedulerRegistry);
    expect(registry.getInterval('outbox')).toBeDefined();
    await other.close();
    expect(registry.doesExist('interval', 'outbox')).toBe(false);
  });

  it('does not register the interval when disabled', () => {
    expect(svc.app.get(SchedulerRegistry).doesExist('interval', 'outbox')).toBe(false);
  });
});
