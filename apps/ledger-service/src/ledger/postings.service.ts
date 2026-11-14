import { Injectable } from '@nestjs/common';
import { assertBalanced } from './domain/balance';
import { PostingConflictError, UnsupportedCurrencyError } from './domain/errors';
import { samePosting, type PostingInput } from './domain/posting';
import { planEntry } from './domain/templates';
import type { JournalEntryView } from './journal-entry.view';
import { LedgerRepository } from './ledger.repository';

@Injectable()
export class PostingsService {
  constructor(private readonly repo: LedgerRepository) {}

  async post(
    p: PostingInput,
    correlationId: string,
  ): Promise<{ status: 200 | 201; view: JournalEntryView }> {
    const planned = planEntry(p);
    assertBalanced(planned.lines);

    const codes = [...new Set(planned.lines.map((l) => l.accountCode))];
    const accounts = await this.repo.accountsByCode(codes);
    const accountIds = new Map<string, string>();
    for (const code of codes) {
      const account = accounts.get(code);
      if (!account) throw new Error(`account ${code} is not in the chart`);
      if (account.currency !== p.currency) throw new UnsupportedCurrencyError(p.currency);
      accountIds.set(code, account.id);
    }

    const result = await this.repo.postEntry(p, planned, correlationId, accountIds);
    if (result.kind === 'CREATED') return { status: 201, view: result.view };
    if (!samePosting(result.stored, p)) throw new PostingConflictError(p.transactionId);
    return { status: 200, view: result.view };
  }
}
