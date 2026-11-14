import { Injectable } from '@nestjs/common';
import { toMinor } from '@eticket/nest-common';
import { PrismaService } from '../common/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { balanceOf } from './domain/balance';
import type { AccountType, PlannedLine, PostingInput } from './domain/posting';
import {
  toEntryView,
  type JournalEntryRow,
  type JournalEntryView,
  type JournalLineRow,
} from './journal-entry.view';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface AccountView {
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}

export interface AccountList {
  data: AccountView[];
  totals: { debitMinor: number; creditMinor: number };
}

type PageLineRow = JournalLineRow & { journal_entry_id: string };

export type PostEntryResult =
  | { kind: 'CREATED'; view: JournalEntryView }
  | { kind: 'EXISTING'; stored: PostingInput; view: JournalEntryView };

@Injectable()
export class LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  async accountsByCode(codes: string[]): Promise<Map<string, { id: string; currency: string }>> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; code: string; currency: string }>>`
      SELECT id, code, currency FROM ledger.accounts WHERE code = ANY(${codes}::text[])`;
    return new Map(rows.map((r) => [r.code, { id: r.id, currency: r.currency }]));
  }

  /**
   * Inserts the entry and its lines in one transaction. The insert blocks
   * behind an uncommitted entry with the same transaction_id; when that one
   * commits, this one gets zero rows and returns the committed entry. The
   * deferred triggers check balance and currency at COMMIT.
   */
  async postEntry(
    p: PostingInput,
    planned: { description: string; lines: PlannedLine[] },
    correlationId: string,
    accountIds: Map<string, string>,
  ): Promise<PostEntryResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO ledger.journal_entries
            (transaction_id, posting_type, payment_reference, order_id, description, currency, correlation_id)
          VALUES (${p.transactionId}::uuid, ${p.postingType}, ${p.paymentReference},
                  ${p.orderId}::uuid, ${planned.description}, ${p.currency}, ${correlationId})
          ON CONFLICT (transaction_id) DO NOTHING
          RETURNING id`;
        const entryId = inserted[0]?.id;

        if (!entryId) {
          const view = await this.readByTransactionId(tx, p.transactionId);
          if (!view) throw new Error('conflicting journal entry not found after ON CONFLICT');
          const debit = view.lines.find((l) => l.direction === 'DEBIT');
          if (!debit) throw new Error('stored journal entry has no debit line');
          const stored: PostingInput = {
            transactionId: view.transactionId,
            postingType: view.postingType,
            orderId: view.orderId,
            paymentReference: view.paymentReference,
            amountMinor: debit.amountMinor,
            currency: view.currency,
          };
          return { kind: 'EXISTING', stored, view } as const;
        }

        for (const line of planned.lines) {
          const accountId = accountIds.get(line.accountCode);
          if (!accountId) throw new Error(`account ${line.accountCode} is not in the chart`);
          await tx.$executeRaw`
            INSERT INTO ledger.journal_lines (journal_entry_id, account_id, direction, amount_minor)
            VALUES (${entryId}::uuid, ${accountId}::uuid, ${line.direction}, ${line.amountMinor}::bigint)`;
        }

        const view = await this.readByTransactionId(tx, p.transactionId);
        if (!view) throw new Error('journal entry vanished inside its own transaction');
        return { kind: 'CREATED', view } as const;
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  findByTransactionId(transactionId: string): Promise<JournalEntryView | null> {
    return this.readByTransactionId(this.prisma, transactionId);
  }

  private async readByTransactionId(
    db: Reader,
    transactionId: string,
  ): Promise<JournalEntryView | null> {
    const entries = await db.$queryRaw<JournalEntryRow[]>`
      SELECT id, transaction_id, posting_type, order_id, payment_reference, description,
             currency, correlation_id, posted_at
      FROM ledger.journal_entries WHERE transaction_id = ${transactionId}::uuid`;
    const entry = entries[0];
    if (!entry) return null;
    const lines = await db.$queryRaw<JournalLineRow[]>`
      SELECT l.id, a.code AS account_code, a.name AS account_name, l.direction, l.amount_minor
      FROM ledger.journal_lines l
      JOIN ledger.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = ${entry.id}::uuid
      ORDER BY (l.direction = 'DEBIT') DESC, a.code`;
    return toEntryView(entry, lines);
  }

  /** Newest first; `id` breaks ties. Lines come in one query for the whole page. */
  async listEntries(
    page: number,
    pageSize: number,
  ): Promise<{ data: JournalEntryView[]; total: number }> {
    const offset = (page - 1) * pageSize;
    const [counts, entries] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM ledger.journal_entries`,
      this.prisma.$queryRaw<JournalEntryRow[]>`
        SELECT id, transaction_id, posting_type, order_id, payment_reference, description,
               currency, correlation_id, posted_at
        FROM ledger.journal_entries
        ORDER BY posted_at DESC, id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
    ]);
    const total = toMinor(counts[0]?.n ?? 0n);
    if (entries.length === 0) return { data: [], total };

    const ids = entries.map((e) => e.id);
    const lines = await this.prisma.$queryRaw<PageLineRow[]>`
      SELECT l.journal_entry_id, l.id, a.code AS account_code, a.name AS account_name,
             l.direction, l.amount_minor
      FROM ledger.journal_lines l
      JOIN ledger.accounts a ON a.id = l.account_id
      WHERE l.journal_entry_id = ANY(${ids}::uuid[])
      ORDER BY (l.direction = 'DEBIT') DESC, a.code`;
    const byEntry = new Map<string, PageLineRow[]>();
    for (const line of lines) {
      const bucket = byEntry.get(line.journal_entry_id);
      if (bucket) bucket.push(line);
      else byEntry.set(line.journal_entry_id, [line]);
    }
    return { data: entries.map((e) => toEntryView(e, byEntry.get(e.id) ?? [])), total };
  }

  /** One aggregate over every line; balances follow each account's normal side. */
  async accountBalances(): Promise<AccountList> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        code: string;
        name: string;
        type: AccountType;
        currency: string;
        debit: bigint | null;
        credit: bigint | null;
      }>
    >`
      SELECT a.code, a.name, a.type, a.currency,
             COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'DEBIT'), 0) AS debit,
             COALESCE(sum(l.amount_minor) FILTER (WHERE l.direction = 'CREDIT'), 0) AS credit
      FROM ledger.accounts a
      LEFT JOIN ledger.journal_lines l ON l.account_id = a.id
      GROUP BY a.id, a.code, a.name, a.type, a.currency
      ORDER BY a.code`;
    let debitTotal = 0;
    let creditTotal = 0;
    const data = rows.map((r) => {
      const debitMinor = toMinor(r.debit ?? 0n);
      const creditMinor = toMinor(r.credit ?? 0n);
      debitTotal += debitMinor;
      creditTotal += creditMinor;
      return {
        code: r.code,
        name: r.name,
        type: r.type,
        currency: r.currency,
        debitMinor,
        creditMinor,
        balanceMinor: balanceOf(r.type, debitMinor, creditMinor),
      };
    });
    return { data, totals: { debitMinor: debitTotal, creditMinor: creditTotal } };
  }
}
