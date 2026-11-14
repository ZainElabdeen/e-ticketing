import { describe, expect, it } from 'vitest';
import { luhnValid } from './luhn';

describe('luhnValid', () => {
  it('accepts a valid number and rejects a bad check digit', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4242424242424241')).toBe(false);
  });
  it('checks only the checksum, not the length', () => {
    expect(luhnValid('0000000000000')).toBe(true);
  });
  it('rejects non-digits and empty input', () => {
    expect(luhnValid('42a2')).toBe(false);
    expect(luhnValid('')).toBe(false);
  });
});
