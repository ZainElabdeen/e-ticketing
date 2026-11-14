import { describe, expect, it } from 'vitest';
import { makeCardSchema } from './cardSchema';

const schema = makeCardSchema(() => new Date(2026, 10, 14));
const valid = { holder: 'Jane Doe', number: '4242 4242 4242 4242', expiry: '11/26', cvc: '123' };

const issuePaths = (input: unknown): string[] => {
  const r = schema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
};

describe('cardSchema', () => {
  it('normalises a valid card to the contract shape', () => {
    const r = schema.safeParse({ ...valid, holder: '  Jane Doe ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({
        number: '4242424242424242',
        expMonth: 11,
        expYear: 2026,
        cvc: '123',
        holder: 'Jane Doe',
      });
      expect(Object.keys(r.data).sort()).toEqual([
        'cvc',
        'expMonth',
        'expYear',
        'holder',
        'number',
      ]);
    }
  });
  it('rejects an expired month with a clear message', () => {
    const r = schema.safeParse({ ...valid, expiry: '10/26' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(['expiry']);
      expect(r.error.issues[0]?.message).toBe('Card has expired');
    }
  });
  it('rejects a malformed expiry', () => {
    expect(issuePaths({ ...valid, expiry: '13/27' })).toContain('expiry');
    expect(issuePaths({ ...valid, expiry: '1/27' })).toContain('expiry');
  });
  it('rejects a bad Luhn number', () => {
    expect(issuePaths({ ...valid, number: '4242424242424241' })).toContain('number');
  });
  it('rejects a short cvc and an empty holder', () => {
    expect(issuePaths({ ...valid, cvc: '12' })).toContain('cvc');
    expect(issuePaths({ ...valid, holder: '' })).toContain('holder');
    expect(issuePaths({ ...valid, holder: '   ' })).toContain('holder');
  });
});
