import { formatDateTime, formatRemaining } from './time';

describe('time', () => {
  it('formats the remaining time as mm:ss', () => {
    expect(formatRemaining(899_000)).toBe('14:59');
    expect(formatRemaining(-5)).toBe('00:00');
    expect(formatRemaining(61_500)).toBe('01:01');
  });

  it('formats a date and time in en-GB', () => {
    const iso = new Date(2026, 10, 14, 13, 5).toISOString();
    expect(formatDateTime(iso)).toBe('14 Nov 2026, 13:05');
  });
});
