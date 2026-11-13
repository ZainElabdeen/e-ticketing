import { newPaymentReference } from './payment-reference';

describe('newPaymentReference', () => {
  it('formats PAY-yyyymmdd-6 chars from the Crockford alphabet', () =>
    expect(newPaymentReference(new Date('2026-11-13T23:59:59Z'))).toMatch(
      /^PAY-20261113-[0-9A-HJKMNP-TV-Z]{6}$/,
    ));
  it('uses the UTC date', () =>
    expect(newPaymentReference(new Date('2026-11-13T22:30:00-05:00'))).toMatch(/^PAY-20261114-/));
  it('is deterministic for given random bytes', () =>
    expect(newPaymentReference(new Date('2026-11-13T00:00:00Z'), () => Buffer.alloc(6, 0))).toBe(
      'PAY-20261113-000000',
    ));
  it('maps byte % 32 onto the alphabet', () =>
    expect(
      newPaymentReference(new Date('2026-11-13T00:00:00Z'), () =>
        Buffer.from([31, 32, 10, 18, 255, 1]),
      ),
    ).toBe('PAY-20261113-Z0AJZ1'));
});
