import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { ContractValidator } from '@eticket/contract-tests';
import { startLedgerService, type RunningLedgerService } from './support/app';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

interface Posting {
  transactionId: string;
  postingType: string;
  orderId: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
}

const posting = (over: Partial<Posting> = {}): Posting => ({
  transactionId: randomUUID(),
  postingType: 'TICKET_SALE',
  orderId: randomUUID(),
  paymentReference: 'PAY-20261113-7F3K9Q',
  amountMinor: 70000,
  currency: 'AED',
  ...over,
});

interface Reply {
  status: number;
  body: {
    code: string;
    transactionId: string;
    description: string;
    correlationId: string | null;
    lines: Array<Record<string, unknown>>;
  };
}

describe('POST /v1/internal/postings', () => {
  let db: TestDatabase;
  let svc: RunningLedgerService;
  let sql: Client;
  const validator = ContractValidator.load('ledger-service');

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ledger-service');
    svc = await startLedgerService(db);
    sql = await db.connectAs('ledger_app');
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await db?.stop();
  });

  const send = async (
    body: unknown,
    key: string = svc.internalKey,
    correlationId?: string,
  ): Promise<Reply> => {
    const req = request(svc.baseUrl).post('/v1/internal/postings');
    if (key) req.set('X-Api-Key', key);
    if (correlationId) req.set('X-Correlation-Id', correlationId);
    const res: Reply = await req.send(body as object);
    return res;
  };

  const counts = async (transactionId: string) => {
    const e = await sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM ledger.journal_entries WHERE transaction_id = $1`,
      [transactionId],
    );
    const l = await sql.query<{ n: string }>(
      `SELECT count(*) AS n FROM ledger.journal_lines l
         JOIN ledger.journal_entries e ON e.id = l.journal_entry_id
        WHERE e.transaction_id = $1`,
      [transactionId],
    );
    return { entries: Number(e.rows[0]?.n), lines: Number(l.rows[0]?.n) };
  };

  describe('a new TICKET_SALE', () => {
    it('answers 201 with a balanced two-line entry', async () => {
      const p = posting();
      const corr = randomUUID();
      const res = await send(p, svc.internalKey, corr);
      expect(res.status).toBe(201);
      validator.assertResponse('createPosting', res.status, res.body);
      expect(res.body.lines).toEqual([
        expect.objectContaining({
          accountCode: '1100',
          accountName: 'Payment Gateway Clearing',
          direction: 'DEBIT',
          amountMinor: 70000,
        }),
        expect.objectContaining({
          accountCode: '4000',
          accountName: 'Ticket Sales Revenue',
          direction: 'CREDIT',
          amountMinor: 70000,
        }),
      ]);
      expect(res.body.description).toBe(`Ticket sale ${p.paymentReference} order ${p.orderId}`);
      expect(res.body.correlationId).toBe(corr);
      expect(res.body.transactionId).toBe(p.transactionId);
      expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
    });
  });

  it('posting the same entry again answers 200 with the same body and writes nothing', async () => {
    const p = posting();
    const first = await send(p);
    const second = await send(p);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
  });

  it('uppercase UUIDs are stored lowercase and replay with 200', async () => {
    const p = posting();
    const upper = {
      ...p,
      transactionId: p.transactionId.toUpperCase(),
      orderId: p.orderId.toUpperCase(),
    };
    const first = await send(upper);
    const second = await send(upper);
    expect(first.status).toBe(201);
    expect(first.body.transactionId).toBe(p.transactionId);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
  });

  it.each([
    ['amountMinor', { amountMinor: 70001 }],
    ['postingType', { postingType: 'UNFULFILLED_PAYMENT' }],
    ['orderId', { orderId: randomUUID() }],
    ['paymentReference', { paymentReference: 'PAY-20261113-OTHER1' }],
  ])('a different %s -> 409 POSTING_CONFLICT, stored entry unchanged', async (_n, change) => {
    const p = posting();
    const first = await send(p);
    const res = await send({ ...p, ...change });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POSTING_CONFLICT');
    validator.assertResponse('createPosting', res.status, res.body);
    expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
    const stored = await send(p);
    expect(stored.status).toBe(200);
    expect(stored.body).toEqual(first.body);
  });

  it('UNFULFILLED_PAYMENT credits 2100', async () => {
    const p = posting({ postingType: 'UNFULFILLED_PAYMENT' });
    const res = await send(p);
    expect(res.status).toBe(201);
    expect(res.body.lines[0]).toMatchObject({ accountCode: '1100', direction: 'DEBIT' });
    expect(res.body.lines[1]).toMatchObject({ accountCode: '2100', direction: 'CREDIT' });
    expect(res.body.description).toBe(
      `Unfulfilled payment ${p.paymentReference} order ${p.orderId}`,
    );
  });

  it('an unsupported currency -> 400 VALIDATION_ERROR and nothing is written', async () => {
    const p = posting({ currency: 'USD' });
    const res = await send(p);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(await counts(p.transactionId)).toEqual({ entries: 0, lines: 0 });
  });

  describe('validation', () => {
    const missingAmount: Partial<Posting> = posting();
    delete missingAmount.amountMinor;
    it.each([
      ['no body', {}],
      ['a missing amountMinor', missingAmount],
      ['amountMinor 0', { ...posting(), amountMinor: 0 }],
      ['a string amountMinor', { ...posting(), amountMinor: '100' }],
      ['an unsafe amountMinor', { ...posting(), amountMinor: Number.MAX_SAFE_INTEGER + 2 }],
      ['a non-UUID transactionId', { ...posting(), transactionId: 'nope' }],
      ['an unknown postingType', { ...posting(), postingType: 'REFUND' }],
      ['a lowercase currency', { ...posting(), currency: 'aed' }],
      ['an extra field', { ...posting(), lines: [] }],
    ])('%s -> 400 VALIDATION_ERROR', async (_n, body) => {
      const res = await send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('keys', () => {
    it('the public key -> 403 FORBIDDEN', async () => {
      const res = await send(posting(), svc.publicKey);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
    it('no key -> 401 UNAUTHORIZED', async () => {
      const res = await send(posting(), '');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('races', () => {
    it('8 identical concurrent postings -> one 201, seven 200, one entry', async () => {
      const p = posting();
      const results = await Promise.all(Array.from({ length: 8 }, () => send(p)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
      for (const r of results) expect(r.body).toEqual(results[0]?.body);
      expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
    });

    it('identical and conflicting postings in parallel -> one 201, the rest 200 or 409, no 500', async () => {
      const p = posting();
      const other = { ...p, amountMinor: 12345 };
      const bodies = [p, p, p, p, other, other, other, other];
      const results = await Promise.all(bodies.map((b) => send(b)));
      const winners = results.filter((r) => r.status === 201);
      expect(winners).toHaveLength(1);
      const winnerIdx = results.findIndex((r) => r.status === 201);
      const winnerBody = bodies[winnerIdx] as Posting;
      results.forEach((r, i) => {
        expect([200, 201, 409]).toContain(r.status);
        const same = (bodies[i] as Posting).amountMinor === winnerBody.amountMinor;
        if (r.status === 200) {
          expect(same).toBe(true);
          expect(r.body).toEqual(winners[0]?.body);
        }
        if (r.status === 409) expect(same).toBe(false);
        if (same && r.status !== 201) expect(r.status).toBe(200);
        if (!same) expect(r.status).toBe(409);
      });
      const stored = await sql.query<{ amount_minor: string }>(
        `SELECT l.amount_minor FROM ledger.journal_lines l
           JOIN ledger.journal_entries e ON e.id = l.journal_entry_id
          WHERE e.transaction_id = $1`,
        [p.transactionId],
      );
      expect(stored.rows.map((r) => Number(r.amount_minor))).toEqual([
        winnerBody.amountMinor,
        winnerBody.amountMinor,
      ]);
      expect(await counts(p.transactionId)).toEqual({ entries: 1, lines: 2 });
    });
  });
});
