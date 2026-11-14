import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { LedgerContractTarget } from './target';

interface Account {
  code: string;
  type: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}
interface AccountList {
  data: Account[];
  totals: { debitMinor: number; creditMinor: number };
}

interface JournalEntry {
  transactionId: string;
  lines: Array<{ accountCode: string; direction: string; amountMinor: number }>;
}

const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE']);

/** Never asserts exact global amounts: the target may hold data and live postings. */
export function register(
  getTarget: () => LedgerContractTarget,
  validator: ContractValidator,
): void {
  const read = (path: string, key?: string) => {
    const target = getTarget();
    return request(target.baseUrl)
      .get(path)
      .set('X-Api-Key', key ?? target.publicApiKey);
  };
  const accounts = async (): Promise<AccountList> => {
    const res = await read('/v1/accounts');
    expect(res.status).toBe(200);
    validator.assertResponse('listAccounts', res.status, res.body);
    return res.body as AccountList;
  };
  const find = (list: AccountList, code: string): Account => {
    const a = list.data.find((x) => x.code === code);
    if (!a) throw new Error(`account ${code} missing from the chart`);
    return a;
  };

  describe('reads', () => {
    it('lists accounts with equal totals and balances on the normal side', async () => {
      const list = await accounts();
      expect(list.totals.debitMinor).toBe(list.totals.creditMinor);
      for (const a of list.data) {
        const expected = DEBIT_NORMAL.has(a.type)
          ? a.debitMinor - a.creditMinor
          : a.creditMinor - a.debitMinor;
        expect(a.balanceMinor).toBe(expected);
      }
    });

    it('shows a new TICKET_SALE in the journal and in the account totals', async () => {
      const target = getTarget();
      const transactionId = randomUUID();
      const before = await accounts();
      const res = await request(target.baseUrl)
        .post('/v1/internal/postings')
        .set('X-Api-Key', target.internalApiKey)
        .send({
          transactionId,
          postingType: 'TICKET_SALE',
          orderId: randomUUID(),
          paymentReference: 'PAY-20261113-7F3K9Q',
          amountMinor: 5000,
          currency: 'AED',
        });
      expect(res.status).toBe(201);

      // Live outbox postings may land on a shared target, so no exact global deltas:
      // find our own entry and check that the totals moved by at least our amount.
      const list = await read('/v1/journal-entries?page=1&pageSize=100');
      expect(list.status).toBe(200);
      validator.assertResponse('listJournalEntries', list.status, list.body);
      const entry = (list.body as { data: JournalEntry[] }).data.find(
        (e) => e.transactionId === transactionId,
      );
      expect(entry).toBeDefined();
      expect(
        entry?.lines.map((l) => ({
          accountCode: l.accountCode,
          direction: l.direction,
          amountMinor: l.amountMinor,
        })),
      ).toEqual([
        { accountCode: '1100', direction: 'DEBIT', amountMinor: 5000 },
        { accountCode: '4000', direction: 'CREDIT', amountMinor: 5000 },
      ]);

      const after = await accounts();
      expect(after.totals.debitMinor).toBe(after.totals.creditMinor);
      expect(find(after, '1100').debitMinor).toBeGreaterThanOrEqual(
        find(before, '1100').debitMinor + 5000,
      );
      expect(find(after, '4000').creditMinor).toBeGreaterThanOrEqual(
        find(before, '4000').creditMinor + 5000,
      );
    });

    it.each(['pageSize=101', 'page=0'])('?%s on journal entries -> 400', async (q) => {
      const res = await read(`/v1/journal-entries?${q}`);
      expect(res.status).toBe(400);
      validator.assertResponse('listJournalEntries', res.status, res.body);
    });

    it('lists journal entries with 200 matching the contract', async () => {
      const res = await read('/v1/journal-entries?pageSize=5');
      expect(res.status).toBe(200);
      validator.assertResponse('listJournalEntries', res.status, res.body);
    });

    it('accepts the public key on both reads', async () => {
      const target = getTarget();
      expect((await read('/v1/accounts', target.publicApiKey)).status).toBe(200);
      expect((await read('/v1/journal-entries', target.publicApiKey)).status).toBe(200);
    });
  });
}
