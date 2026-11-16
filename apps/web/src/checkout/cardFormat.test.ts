import { describe, expect, it } from 'vitest';
import { formatCardNumber, formatCvc, formatExpiry } from './cardFormat';

describe('formatCardNumber', () => {
  it('caps at 16 digits and groups in fours', () => {
    expect(formatCardNumber('4242424242424242999')).toBe('4242 4242 4242 4242');
  });
  it('strips non-digits', () => {
    expect(formatCardNumber('42-42 42')).toBe('4242 42');
  });
  it('keeps empty empty', () => {
    expect(formatCardNumber('')).toBe('');
  });
});

describe('formatExpiry', () => {
  it('prefixes a zero for first digits 2-9', () => {
    expect(formatExpiry('2', '')).toBe('02/');
    expect(formatExpiry('9', '')).toBe('09/');
  });
  it('keeps 0 and 1 as the start of a month', () => {
    expect(formatExpiry('0', '')).toBe('0');
    expect(formatExpiry('1', '')).toBe('1');
  });
  it('adds the slash after two valid month digits', () => {
    expect(formatExpiry('12', '1')).toBe('12/');
  });
  it('formats a full expiry and caps at four digits', () => {
    expect(formatExpiry('1225', '12/2')).toBe('12/25');
    expect(formatExpiry('122599', '12/25')).toBe('12/25');
  });
  it('rejects a month above 12 or 00', () => {
    expect(formatExpiry('13', '1')).toBe('1');
    expect(formatExpiry('00', '0')).toBe('0');
  });
  it('backspace on the slash removes it and the last month digit', () => {
    expect(formatExpiry('12', '12/')).toBe('1');
    expect(formatExpiry('04', '04/')).toBe('0');
  });
  it('backspace after the year keeps the slash logic', () => {
    expect(formatExpiry('12/2', '12/25')).toBe('12/2');
  });
});

describe('formatCvc', () => {
  it('keeps digits only, max four', () => {
    expect(formatCvc('12a3456')).toBe('1234');
  });
});
