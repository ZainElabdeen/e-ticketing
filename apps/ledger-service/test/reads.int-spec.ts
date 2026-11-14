import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { ContractValidator } from '@eticket/contract-tests';
import { startLedgerService, type RunningLedgerService } from './support/app';

interface AccountBody {
  code: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}
interface AccountsReply {
  data: AccountBody[];
  totals: { debitMinor: number; creditMinor: number };
}
interface EntriesReply {
  data: Array<{ transactionId: string; lines: unknown[] }>;
  page: number;
  pageSize: number;
  total: number;
}

describe('GET /v1/accounts and /v1/journal-entries', () => {
  let db: TestDatabase;
  let svc: RunningLedgerService;
  const validator = ContractValidator.load('ledger-service');

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ledger-service');
    svc = await startLedgerService(db);
  });

  afterAll(async () => {
    await svc?.close();
    await db?.stop();
  });

  const get = (path: string) => request(svc.baseUrl).get(path).set('X-Api-Key', svc.publicKey);

  const post = (postingType: string, amountMinor: number, transactionId = randomUUID()) =>
    request(svc.baseUrl).post('/v1/internal/postings').set('X-Api-Key', svc.internalKey).send({
      transactionId,
      postingType,
      orderId: randomUUID(),
      paymentReference: 'PAY-20261113-7F3K9Q',
      amountMinor,
      currency: 'AED',
    });

  const byCode = (r: AccountsReply, code: string): AccountBody => {
    const a = r.data.find((x) => x.code === code);
    if (!a) throw new Error(`account ${code} missing`);
    return a;
  };

  it('lists all accounts at zero on an empty ledger', async () => {
    const res = await get('/v1/accounts');
    const body = res.body as AccountsReply;
    expect(res.status).toBe(200);
    validator.assertResponse('listAccounts', res.status, res.body);
    expect(body.data.map((a) => a.code)).toEqual(['1100', '2100', '4000']);
    for (const a of body.data) {
      expect([a.debitMinor, a.creditMinor, a.balanceMinor]).toEqual([0, 0, 0]);
    }
    expect(body.totals).toEqual({ debitMinor: 0, creditMinor: 0 });
  });

  it('lists an empty page of journal entries', async () => {
    const res = await get('/v1/journal-entries');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  describe('after postings', () => {
    const ids: string[] = [];

    beforeAll(async () => {
      for (const [type, amount] of [
        ['TICKET_SALE', 70000],
        ['TICKET_SALE', 10000],
        ['UNFULFILLED_PAYMENT', 20000],
      ] as const) {
        const id = randomUUID();
        ids.push(id);
        expect((await post(type, amount, id)).status).toBe(201);
      }
    });

    it('derives balances from the lines', async () => {
      const res = await get('/v1/accounts');
      const body = res.body as AccountsReply;
      validator.assertResponse('listAccounts', res.status, res.body);
      expect(byCode(body, '1100')).toMatchObject({
        debitMinor: 100000,
        creditMinor: 0,
        balanceMinor: 100000,
      });
      expect(byCode(body, '4000')).toMatchObject({
        debitMinor: 0,
        creditMinor: 80000,
        balanceMinor: 80000,
      });
      expect(byCode(body, '2100')).toMatchObject({
        debitMinor: 0,
        creditMinor: 20000,
        balanceMinor: 20000,
      });
      expect(body.totals).toEqual({ debitMinor: 100000, creditMinor: 100000 });
    });

    it('keeps clearing equal to revenue plus refunds payable', async () => {
      const body = (await get('/v1/accounts')).body as AccountsReply;
      expect(byCode(body, '1100').balanceMinor).toBe(
        byCode(body, '4000').balanceMinor + byCode(body, '2100').balanceMinor,
      );
    });

    it('pages entries newest first with their lines', async () => {
      const first = await get('/v1/journal-entries?pageSize=2');
      const b1 = first.body as EntriesReply;
      expect(first.status).toBe(200);
      validator.assertResponse('listJournalEntries', first.status, first.body);
      expect(b1.total).toBe(3);
      expect(b1.page).toBe(1);
      expect(b1.pageSize).toBe(2);
      expect(b1.data.map((e) => e.transactionId)).toEqual([ids[2], ids[1]]);
      expect(b1.data.every((e) => e.lines.length === 2)).toBe(true);
      expect(b1.data[0]?.lines).toEqual([
        expect.objectContaining({ accountCode: '1100', direction: 'DEBIT' }),
        expect.objectContaining({ accountCode: '2100', direction: 'CREDIT' }),
      ]);

      const second = await get('/v1/journal-entries?pageSize=2&page=2');
      const b2 = second.body as EntriesReply;
      validator.assertResponse('listJournalEntries', second.status, second.body);
      expect(b2.data.map((e) => e.transactionId)).toEqual([ids[0]]);
    });

    it('rejects pageSize above 100 with 400', async () => {
      const res = await get('/v1/journal-entries?pageSize=101');
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
    });
  });
});
