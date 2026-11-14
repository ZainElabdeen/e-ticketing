import { isCardExpired } from './card-expiry';

const now = new Date('2026-11-14T10:00:00Z');

describe('isCardExpired', () => {
  it('current month is not expired', () => expect(isCardExpired(11, 2026, now)).toBe(false));
  it('previous month is expired', () => expect(isCardExpired(10, 2026, now)).toBe(true));
  it('previous year is expired', () => expect(isCardExpired(12, 2025, now)).toBe(true));
  it('future is not expired', () => expect(isCardExpired(1, 2027, now)).toBe(false));
});
