import { isLuhnValid } from './luhn';

describe('isLuhnValid', () => {
  it.each(['4242424242424242', '5555555555554444', '378282246310005'])('accepts %s', (n) =>
    expect(isLuhnValid(n)).toBe(true),
  );
  it.each(['4242424242424241', '1234567812345678', '', '4242a24242424242'])('rejects %s', (n) =>
    expect(isLuhnValid(n)).toBe(false),
  );
});
