import { decideConfirmation, priceOrder, sortLines, type PricedLine } from './order';

const line = (code: PricedLine['ticketTypeCode'], quantity: number, unit: number): PricedLine => ({
  ticketTypeCode: code,
  ticketTypeId: `id-${code}`,
  currency: 'AED',
  quantity,
  unitPriceMinor: unit,
  lineTotalMinor: unit * quantity,
});

describe('sortLines', () => {
  it('orders by ticket type code ascending without mutating the input', () => {
    const input = [
      { ticketTypeCode: 'VIP' as const },
      { ticketTypeCode: 'GOLD' as const },
      { ticketTypeCode: 'PREMIUM' as const },
    ];
    const sorted = sortLines(input);
    expect(sorted.map((l) => l.ticketTypeCode)).toEqual(['GOLD', 'PREMIUM', 'VIP']);
    expect(input.map((l) => l.ticketTypeCode)).toEqual(['VIP', 'GOLD', 'PREMIUM']);
  });
});

describe('priceOrder', () => {
  it('sums line totals', () => {
    const result = priceOrder([line('GOLD', 2, 10000), line('VIP', 1, 50000)]);
    expect(result.totalMinor).toBe(70000);
    expect(result.lines).toHaveLength(2);
    expect(result.currency).toBe('AED');
  });

  it('throws when a line total does not equal unit price times quantity', () => {
    const bad = { ...line('GOLD', 2, 10000), lineTotalMinor: 1 };
    expect(() => priceOrder([bad])).toThrow();
  });

  it('throws when lines mix currencies', () => {
    const usd = { ...line('VIP', 1, 50000), currency: 'USD' };
    expect(() => priceOrder([line('GOLD', 1, 10000), usd])).toThrow(/currenc/);
  });
});

describe('decideConfirmation', () => {
  const T = '11111111-1111-4111-8111-111111111111';
  const U = '22222222-2222-4222-8222-222222222222';
  it('confirms a pending order by moving reserved to sold', () =>
    expect(decideConfirmation({ status: 'PENDING', paidTransactionId: null }, T)).toBe(
      'CONFIRM_PENDING',
    ));
  it('honors an expired order if quota still allows', () =>
    expect(decideConfirmation({ status: 'EXPIRED', paidTransactionId: null }, T)).toBe(
      'CONFIRM_EXPIRED',
    ));
  it('replays a confirmation with the same transaction', () =>
    expect(decideConfirmation({ status: 'CONFIRMED', paidTransactionId: T }, T)).toBe('REPLAY'));
  it('rejects a confirmation by a different transaction', () =>
    expect(decideConfirmation({ status: 'CONFIRMED', paidTransactionId: U }, T)).toBe('REJECT'));
});
