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

const DEBIT_NORMAL = new Set(['ASSET', 'EXPENSE']);

/** Compares deltas only: the target may already hold any amount of data. */
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

    it('reflects a new TICKET_SALE as an exact delta on 1100 and 4000', async () => {
      const target = getTarget();
      const before = await accounts();
      const res = await request(target.baseUrl)
        .post('/v1/internal/postings')
        .set('X-Api-Key', target.internalApiKey)
        .send({
          transactionId: randomUUID(),
          postingType: 'TICKET_SALE',
          orderId: randomUUID(),
          paymentReference: 'PAY-20261113-7F3K9Q',
          amountMinor: 5000,
          currency: 'AED',
        });
      expect(res.status).toBe(201);
      const after = await accounts();
      expect(find(after, '1100').debitMinor - find(before, '1100').debitMinor).toBe(5000);
      expect(find(after, '4000').creditMinor - find(before, '4000').creditMinor).toBe(5000);
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
