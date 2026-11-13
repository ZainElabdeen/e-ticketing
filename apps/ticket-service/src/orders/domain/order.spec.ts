import { priceOrder, sortLines, type PricedLine } from './order';

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
