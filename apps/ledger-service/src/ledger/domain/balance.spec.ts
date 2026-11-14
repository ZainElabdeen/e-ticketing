import { assertBalanced, balanceOf, isDebitNormal } from './balance';
import { UnbalancedEntryError } from './errors';
import type { PlannedLine } from './posting';

const d = (n: number): PlannedLine => ({ accountCode: '1100', direction: 'DEBIT', amountMinor: n });
const c = (n: number): PlannedLine => ({
  accountCode: '4000',
  direction: 'CREDIT',
  amountMinor: n,
});

describe('assertBalanced', () => {
  it('accepts two equal lines', () => {
    expect(() => assertBalanced([d(100), c(100)])).not.toThrow();
  });
  it('rejects a single line', () => {
    expect(() => assertBalanced([d(100)])).toThrow(UnbalancedEntryError);
  });
  it('rejects unequal debit and credit', () => {
    expect(() => assertBalanced([d(100), c(90)])).toThrow(UnbalancedEntryError);
  });
  it.each([0, 1.5, -5])('rejects amount %p', (n) => {
    expect(() => assertBalanced([d(n), c(n)])).toThrow(UnbalancedEntryError);
  });
  it('is a 500 INTERNAL_ERROR, never a client error', () => {
    try {
      assertBalanced([d(1)]);
    } catch (e) {
      expect(e).toMatchObject({ code: 'INTERNAL_ERROR', httpStatus: 500 });
    }
    expect.assertions(1);
  });
});

describe('balanceOf', () => {
  it.each([
    ['ASSET', 100, 30, 70],
    ['REVENUE', 30, 100, 70],
    ['LIABILITY', 0, 50, 50],
    ['EXPENSE', 10, 0, 10],
  ] as const)('%s debit %p credit %p gives %p', (type, debit, credit, expected) => {
    expect(balanceOf(type, debit, credit)).toBe(expected);
  });
  it('treats only ASSET and EXPENSE as debit-normal', () => {
    expect(isDebitNormal('ASSET')).toBe(true);
    expect(isDebitNormal('EXPENSE')).toBe(true);
    expect(isDebitNormal('LIABILITY')).toBe(false);
    expect(isDebitNormal('EQUITY')).toBe(false);
    expect(isDebitNormal('REVENUE')).toBe(false);
  });
});
