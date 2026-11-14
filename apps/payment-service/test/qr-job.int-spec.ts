import { SchedulerRegistry } from '@nestjs/schedule';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { PaymentNotCancellableError } from '../src/payments/domain/errors';
import { PaymentsService } from '../src/payments/payments.service';
import { QrSuccessJob } from '../src/payments/qr-success.job';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { postPayment, qrBody } from './support/payments';
import { stubPayableOrder } from './support/stubs';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

describe('QrSuccessJob', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  let sql: Client;
  let job: QrSuccessJob;
  let service: PaymentsService;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    svc = await startPaymentService(db, { ticket, ledger }, { QR_JOB_BATCH_SIZE: '2' });
    sql = await db.connectAs('payments_app');
    job = svc.app.get(QrSuccessJob);
    service = svc.app.get(PaymentsService);
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  beforeEach(async () => {
    // Park leftovers so each test only sees its own due payments.
    await sql.query(
      `UPDATE payments.payments SET status = 'CANCELLED', cancelled_at = now() WHERE status = 'PENDING'`,
    );
  });

  async function newQr(due: boolean): Promise<string> {
    const order = stubPayableOrder(ticket);
    const res = await postPayment(svc, qrBody(order.id));
    expect(res.status).toBe(201);
    if (due) await makeDue(res.body.id);
    return res.body.id;
  }

  const makeDue = (id: string) =>
    sql.query(
      `UPDATE payments.payments SET succeed_after = now() - interval '1 second' WHERE id = $1`,
      [id],
    );

  async function counts(id: string): Promise<{ status: string; tx: number; events: number }> {
    const p = await sql.query<{ status: string }>(
      `SELECT status FROM payments.payments WHERE id = $1`,
      [id],
    );
    const t = await sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM payments.transactions WHERE payment_id = $1`,
      [id],
    );
    const e = await sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM payments.outbox_events WHERE payload->>'paymentId' = $1`,
      [id],
    );
    return {
      status: p.rows[0]?.status ?? '',
      tx: Number(t.rows[0]?.n),
      events: Number(e.rows[0]?.n),
    };
  }

  it('succeeds a due payment once, with one transaction and one outbox event', async () => {
    const id = await newQr(true);
    expect(await job.runOnce()).toBe(1);
    expect(await counts(id)).toEqual({ status: 'SUCCEEDED', tx: 1, events: 1 });
    const payload = await sql.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM payments.outbox_events WHERE payload->>'paymentId' = $1`,
      [id],
    );
    expect(payload.rows[0]?.payload).not.toHaveProperty('correlationId');
    expect(await job.runOnce()).toBe(0);
    expect(await counts(id)).toEqual({ status: 'SUCCEEDED', tx: 1, events: 1 });
  });

  it('leaves a not-yet-due payment alone', async () => {
    const id = await newQr(false);
    expect(await job.runOnce()).toBe(0);
    expect((await counts(id)).status).toBe('PENDING');
  });

  it('leaves a cancelled payment alone', async () => {
    const id = await newQr(true);
    await service.cancel(id);
    expect(await job.runOnce()).toBe(0);
    expect(await counts(id)).toEqual({ status: 'CANCELLED', tx: 0, events: 0 });
  });

  it('respects the batch size', async () => {
    await newQr(true);
    await newQr(true);
    await newQr(true);
    expect(await job.runOnce()).toBe(2);
    expect(await job.runOnce()).toBe(1);
    expect(await job.runOnce()).toBe(0);
  });

  it('a flip racing a cancel has exactly one winner (30 iterations)', async () => {
    let flipWins = 0;
    let cancelWins = 0;
    for (let i = 0; i < 30; i++) {
      const id = await newQr(true);
      const [run, cancel] = await Promise.allSettled([job.runOnce(), service.cancel(id)]);
      if (cancel.status === 'rejected') {
        expect(cancel.reason).toBeInstanceOf(PaymentNotCancellableError);
      }
      if (run.status === 'rejected') throw run.reason;
      const state = await counts(id);
      if (cancel.status === 'rejected') {
        flipWins += 1;
        expect(run.value).toBe(1);
        expect(state).toEqual({ status: 'SUCCEEDED', tx: 1, events: 1 });
      } else {
        cancelWins += 1;
        expect(run.value).toBe(0);
        expect(state).toEqual({ status: 'CANCELLED', tx: 0, events: 0 });
      }
    }
    // Both outcomes are legal, so only the total is asserted; the split shows in the failure message.
    expect({ total: flipWins + cancelWins }).toEqual({ total: 30 });
    process.stderr.write(`qr race: flip won ${flipWins}, cancel won ${cancelWins}
`);
  });

  it('registers the interval when enabled and removes it on close', async () => {
    const other = await startPaymentService(
      db,
      { ticket, ledger },
      {
        QR_JOB_ENABLED: 'true',
        QR_JOB_INTERVAL_SECONDS: '1',
      },
    );
    const registry = other.app.get(SchedulerRegistry);
    expect(registry.getInterval('qr-success')).toBeDefined();
    await other.close();
    expect(registry.doesExist('interval', 'qr-success')).toBe(false);
  });

  it('does not register the interval when disabled', () => {
    expect(svc.app.get(SchedulerRegistry).doesExist('interval', 'qr-success')).toBe(false);
  });
});
