import { UnbalancedEntryError } from './errors';
import { planEntry, TEMPLATES } from './templates';
import type { PostingInput } from './posting';

const base: PostingInput = {
  transactionId: '11111111-1111-4111-8111-111111111111',
  postingType: 'TICKET_SALE',
  orderId: '22222222-2222-4222-8222-222222222222',
  paymentReference: 'PAY-20261113-7F3K9Q',
  amountMinor: 70000,
  currency: 'AED',
};

describe('planEntry', () => {
  it('plans a ticket sale as debit 1100 / credit 4000', () => {
    const plan = planEntry(base);
    expect(plan.lines).toEqual([
      { accountCode: '1100', direction: 'DEBIT', amountMinor: 70000 },
      { accountCode: '4000', direction: 'CREDIT', amountMinor: 70000 },
    ]);
    expect(plan.description).toBe(`Ticket sale PAY-20261113-7F3K9Q order ${base.orderId}`);
  });

  it('plans an unfulfilled payment as credit 2100', () => {
    const plan = planEntry({ ...base, postingType: 'UNFULFILLED_PAYMENT' });
    expect(plan.lines[1]).toEqual({ accountCode: '2100', direction: 'CREDIT', amountMinor: 70000 });
    expect(plan.description).toBe(`Unfulfilled payment PAY-20261113-7F3K9Q order ${base.orderId}`);
  });

  it('rejects a non-positive amount through its own balance check', () => {
    expect(() => planEntry({ ...base, amountMinor: 0 })).toThrow(UnbalancedEntryError);
  });

  it('has a template for every posting type', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['TICKET_SALE', 'UNFULFILLED_PAYMENT']);
  });
});
