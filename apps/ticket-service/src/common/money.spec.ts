import { toMinor } from './money';

describe('toMinor', () => {
  it('converts a safe bigint to a number', () => expect(toMinor(10000n)).toBe(10000));

  it('throws RangeError beyond the safe integer range', () =>
    expect(() => toMinor(2n ** 60n)).toThrow(RangeError));
});
