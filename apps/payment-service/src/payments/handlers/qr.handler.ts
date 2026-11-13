import { InvalidCardError } from '../domain/errors';
import type { CreatePaymentInput } from '../domain/types';
import type { HandlerResult, PaymentContext, PaymentHandler } from './payment-handler';

export class QrHandler implements PaymentHandler {
  readonly method = 'QR' as const;

  constructor(private readonly successDelaySeconds: number) {}

  /** The DTO rejects a card on QR with 400 first; this is defense in depth. */
  validate(input: CreatePaymentInput): void {
    if (input.card) throw new InvalidCardError('card is not allowed for QR');
  }

  initiate(ctx: PaymentContext): HandlerResult {
    return {
      kind: 'PENDING',
      details: { qrPayload: `eticket:pay:${ctx.paymentId}` },
      succeedAfterSeconds: this.successDelaySeconds,
    };
  }
}
