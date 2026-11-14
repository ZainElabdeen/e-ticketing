import { UnbalancedEntryError } from './errors';
import type { AccountType, PlannedLine } from './posting';

export function assertBalanced(lines: PlannedLine[]): void {
  if (lines.length < 2) throw new UnbalancedEntryError('an entry needs at least two lines');
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0) {
      throw new UnbalancedEntryError('every amount must be a positive safe integer');
    }
    if (line.direction === 'DEBIT') debit += line.amountMinor;
    else credit += line.amountMinor;
  }
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit) || debit !== credit) {
    throw new UnbalancedEntryError(`debits ${debit} do not equal credits ${credit}`);
  }
}

export function isDebitNormal(type: AccountType): boolean {
  return type === 'ASSET' || type === 'EXPENSE';
}

export function balanceOf(type: AccountType, debitMinor: number, creditMinor: number): number {
  return isDebitNormal(type) ? debitMinor - creditMinor : creditMinor - debitMinor;
}
