import { canonicalJson, hashInput, requestHash } from './request-hash';
import type { CreatePaymentInput } from './types';

const ORDER_ID = '0b1f6a3e-2f7c-4a39-9d3c-3f6c7c1d2a10';
const cardInput: CreatePaymentInput = {
  orderId: ORDER_ID,
  method: 'CARD',
  card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123', holder: 'Jane Doe' },
};

describe('request hash', () => {
  it('uses last4, never the PAN or CVC', () => {
    const json = canonicalJson(hashInput(cardInput));
    expect(json).toBe(
      `{"card":{"expMonth":12,"expYear":2030,"holder":"Jane Doe","last4":"4242"},"method":"CARD","orderId":"${ORDER_ID}"}`,
    );
    expect(json).not.toContain('4242424242424242');
    expect(json).not.toContain('123"');
  });

  it('same body gives the same hash regardless of key order', () => {
    const reordered: CreatePaymentInput = {
      method: 'CARD',
      card: {
        holder: 'Jane Doe',
        cvc: '123',
        expYear: 2030,
        expMonth: 12,
        number: '4242424242424242',
      },
      orderId: ORDER_ID,
    };
    expect(requestHash(reordered)).toBe(requestHash(cardInput));
    expect(requestHash(cardInput)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different card last4 gives a different hash', () => {
    const other = { ...cardInput, card: { ...cardInput.card!, number: '5555555555554444' } };
    expect(requestHash(other)).not.toBe(requestHash(cardInput));
  });

  it('QR without card hashes without a card key', () => {
    const qr: CreatePaymentInput = { orderId: ORDER_ID, method: 'QR' };
    expect(canonicalJson(hashInput(qr))).toBe(`{"method":"QR","orderId":"${ORDER_ID}"}`);
  });

  it('canonicalJson sorts nested keys and arrays elements', () => {
    expect(canonicalJson({ b: [{ d: 1, c: 2 }], a: null })).toBe('{"a":null,"b":[{"c":2,"d":1}]}');
  });
});
