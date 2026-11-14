import { DomainError } from '@eticket/nest-common';
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
  it.each([
    ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('rejects %s', (_label, n) => {
    expect(() => assertBalanced([d(n), c(n)])).toThrow(UnbalancedEntryError);
  });
  it('rejects a sum that overflows the safe integer range', () => {
    const half = Number.MAX_SAFE_INTEGER - 1;
    expect(() => assertBalanced([d(half), d(half), c(half), c(half)])).toThrow(
      UnbalancedEntryError,
    );
  });
  it('rejects an empty entry', () => {
    expect(() => assertBalanced([])).toThrow(UnbalancedEntryError);
  });
  it('rejects debit-only lines', () => {
    expect(() => assertBalanced([d(50), d(50)])).toThrow(UnbalancedEntryError);
  });
  it('accepts a balanced three-line entry', () => {
    expect(() => assertBalanced([d(60), d(40), c(100)])).not.toThrow();
  });
  it('is a plain Error, not a DomainError, so the filter answers a generic 500', () => {
    try {
      assertBalanced([d(1)]);
    } catch (e) {
      expect(e).toBeInstanceOf(UnbalancedEntryError);
      expect(e).not.toBeInstanceOf(DomainError);
      expect(e).not.toHaveProperty('httpStatus');
    }
    expect.assertions(3);
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
