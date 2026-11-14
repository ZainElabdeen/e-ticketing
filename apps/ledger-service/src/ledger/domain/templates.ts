import { assertBalanced } from './balance';
import type { PlannedLine, PostingInput, PostingType } from './posting';

export const TEMPLATES: Record<
  PostingType,
  { debit: string; credit: string; describe(p: PostingInput): string }
> = {
  TICKET_SALE: {
    debit: '1100',
    credit: '4000',
    describe: (p) => `Ticket sale ${p.paymentReference} order ${p.orderId}`,
  },
  UNFULFILLED_PAYMENT: {
    debit: '1100',
    credit: '2100',
    describe: (p) => `Unfulfilled payment ${p.paymentReference} order ${p.orderId}`,
  },
};

export function planEntry(p: PostingInput): { description: string; lines: PlannedLine[] } {
  const t = TEMPLATES[p.postingType];
  const lines: PlannedLine[] = [
    { accountCode: t.debit, direction: 'DEBIT', amountMinor: p.amountMinor },
    { accountCode: t.credit, direction: 'CREDIT', amountMinor: p.amountMinor },
  ];
  assertBalanced(lines);
  return { description: t.describe(p), lines };
}
