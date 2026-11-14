import { toMinor } from '@eticket/nest-common';
import type { Direction, PostingType } from './domain/posting';

/** The API shape of a journal entry (contract schema `JournalEntry`). */
export interface JournalEntryView {
  id: string;
  transactionId: string;
  postingType: PostingType;
  orderId: string;
  paymentReference: string;
  description: string;
  currency: string;
  correlationId: string | null;
  postedAt: string;
  lines: Array<{
    id: string;
    accountCode: string;
    accountName: string;
    direction: Direction;
    amountMinor: number;
  }>;
}

export interface JournalEntryRow {
  id: string;
  transaction_id: string;
  posting_type: PostingType;
  order_id: string;
  payment_reference: string;
  description: string;
  currency: string;
  correlation_id: string | null;
  posted_at: Date;
}

export interface JournalLineRow {
  id: string;
  account_code: string;
  account_name: string;
  direction: Direction;
  amount_minor: bigint;
}

export function toEntryView(row: JournalEntryRow, lines: JournalLineRow[]): JournalEntryView {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    postingType: row.posting_type,
    orderId: row.order_id,
    paymentReference: row.payment_reference,
    description: row.description,
    currency: row.currency,
    correlationId: row.correlation_id,
    postedAt: row.posted_at.toISOString(),
    lines: lines.map((l) => ({
      id: l.id,
      accountCode: l.account_code,
      accountName: l.account_name,
      direction: l.direction,
      amountMinor: toMinor(l.amount_minor),
    })),
  };
}
