import { formatMinor, sumMinor } from './money';

describe('money', () => {
  it('formats minor units with grouping and two decimals', () => {
    expect(formatMinor(10000, 'AED')).toMatch(/^AED\s100\.00$/u);
    expect(formatMinor(123456789, 'AED')).toMatch(/^AED\s1,234,567\.89$/u);
    expect(formatMinor(0, 'AED')).toMatch(/^AED\s0\.00$/u);
  });

  it('sums lines in minor units', () => {
    expect(
      sumMinor([
        { priceMinor: 10000, quantity: 2 },
        { priceMinor: 50000, quantity: 1 },
      ]),
    ).toBe(70000);
    expect(sumMinor([])).toBe(0);
  });
});
