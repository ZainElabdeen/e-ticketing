import { InvalidCardError } from '../domain/errors';
import type { CreatePaymentInput } from '../domain/types';
import { CardHandler } from './card.handler';
import { HandlerRegistry } from './handler-registry';
import { QrHandler } from './qr.handler';

const now = new Date('2026-11-14T10:00:00Z');
const ORDER_ID = '0b1f6a3e-2f7c-4a39-9d3c-3f6c7c1d2a10';
const PAN = '4242424242424242';
const card = { number: PAN, expMonth: 12, expYear: 2030, cvc: '987', holder: 'Jane Doe' };
const cardInput: CreatePaymentInput = { orderId: ORDER_ID, method: 'CARD', card };

function messageOf(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidCardError);
    expect((e as InvalidCardError).httpStatus).toBe(422);
    expect((e as InvalidCardError).code).toBe('INVALID_CARD');
    return (e as Error).message;
  }
  throw new Error('did not throw');
}

describe('CardHandler', () => {
  const handler = new CardHandler();

  it('accepts a valid card', () => expect(() => handler.validate(cardInput, now)).not.toThrow());

  it('Luhn-invalid gives InvalidCardError whose message has no PAN or CVC', () => {
    const bad = { ...cardInput, card: { ...card, number: '4242424242424241' } };
    const msg = messageOf(() => handler.validate(bad, now));
    expect(msg).not.toContain('4242424242424241');
    expect(msg).not.toContain('987');
  });

  it('expired gives InvalidCardError without the PAN', () => {
    const bad = { ...cardInput, card: { ...card, expMonth: 10, expYear: 2026 } };
    const msg = messageOf(() => handler.validate(bad, now));
    expect(msg).not.toContain(PAN);
  });

  it('missing card gives InvalidCardError', () => {
    messageOf(() => handler.validate({ orderId: ORDER_ID, method: 'CARD' }, now));
  });

  it('initiate gives SUCCEEDED with last4', () =>
    expect(
      handler.initiate({
        paymentId: 'p1',
        orderId: ORDER_ID,
        amountMinor: 10000,
        currency: 'AED',
        input: cardInput,
        now,
      }),
    ).toEqual({ kind: 'SUCCEEDED', details: { cardLast4: '4242' } }));
});

describe('QrHandler', () => {
  const handler = new QrHandler(8);

  it('validate rejects a card as defense in depth', () => {
    const msg = messageOf(() => handler.validate({ orderId: ORDER_ID, method: 'QR', card }));
    expect(msg).not.toContain(PAN);
  });

  it('validate accepts QR without a card', () =>
    expect(() => handler.validate({ orderId: ORDER_ID, method: 'QR' })).not.toThrow());

  it('initiate gives PENDING, qrPayload eticket:pay:<paymentId>, succeedAfterSeconds = delay', () =>
    expect(
      handler.initiate({
        paymentId: 'abc',
        orderId: ORDER_ID,
        amountMinor: 10000,
        currency: 'AED',
        input: { orderId: ORDER_ID, method: 'QR' },
        now,
      }),
    ).toEqual({
      kind: 'PENDING',
      details: { qrPayload: 'eticket:pay:abc' },
      succeedAfterSeconds: 8,
    }));
});

describe('HandlerRegistry', () => {
  it('returns the handler for a method', () => {
    const card = new CardHandler();
    expect(new HandlerRegistry([card, new QrHandler(8)]).get('CARD')).toBe(card);
  });

  it('throws on an unknown method', () =>
    expect(() => new HandlerRegistry([new CardHandler()]).get('QR')).toThrow(/QR/));

  it('throws on duplicates', () =>
    expect(() => new HandlerRegistry([new CardHandler(), new CardHandler()])).toThrow(/duplicate/));
});
