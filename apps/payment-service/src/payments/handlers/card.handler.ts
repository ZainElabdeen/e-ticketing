import { isCardExpired } from '../domain/card-expiry';
import { InvalidCardError } from '../domain/errors';
import { isLuhnValid } from '../domain/luhn';
import type { CreatePaymentInput } from '../domain/types';
import type { HandlerResult, PaymentContext, PaymentHandler } from './payment-handler';

export class CardHandler implements PaymentHandler {
  readonly method = 'CARD' as const;

  /** Messages never include the PAN or CVC. */
  validate(input: CreatePaymentInput, now: Date): void {
    const card = input.card;
    if (!card) throw new InvalidCardError('card details are required');
    if (!isLuhnValid(card.number)) throw new InvalidCardError('card number is invalid');
    if (isCardExpired(card.expMonth, card.expYear, now)) {
      throw new InvalidCardError('card is expired');
    }
  }

  initiate(ctx: PaymentContext): HandlerResult {
    const card = ctx.input.card;
    if (!card) throw new InvalidCardError('card details are required');
    return { kind: 'SUCCEEDED', details: { cardLast4: card.number.slice(-4) } };
  }
}
