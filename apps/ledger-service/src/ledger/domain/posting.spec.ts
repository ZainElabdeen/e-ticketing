import { PostingConflictError, UnsupportedCurrencyError } from './errors';
import { samePosting, type PostingInput } from './posting';

const base: PostingInput = {
  transactionId: 't1',
  postingType: 'TICKET_SALE',
  orderId: 'o1',
  paymentReference: 'PAY-1',
  amountMinor: 100,
  currency: 'AED',
};

describe('samePosting', () => {
  it('is true for identical postings', () => {
    expect(samePosting(base, { ...base })).toBe(true);
  });
  it.each<[string, Partial<PostingInput>]>([
    ['postingType', { postingType: 'UNFULFILLED_PAYMENT' }],
    ['orderId', { orderId: 'o2' }],
    ['paymentReference', { paymentReference: 'PAY-2' }],
    ['amountMinor', { amountMinor: 101 }],
    ['currency', { currency: 'USD' }],
  ])('is false when %s differs', (_field, change) => {
    expect(samePosting(base, { ...base, ...change })).toBe(false);
  });
});

describe('errors', () => {
  it('maps unsupported currency to 400 VALIDATION_ERROR', () => {
    const e = new UnsupportedCurrencyError();
    expect(e).toMatchObject({ code: 'VALIDATION_ERROR', httpStatus: 400 });
    expect(e.message).toBe('currency is not supported by the ledger accounts');
  });
  it('maps conflict to 409 and names only the transaction id', () => {
    const e = new PostingConflictError('t1');
    expect(e).toMatchObject({ code: 'POSTING_CONFLICT', httpStatus: 409 });
    expect(e.message).toContain('t1');
    expect(e.message).not.toMatch(/PAY-|AED/);
  });
});
