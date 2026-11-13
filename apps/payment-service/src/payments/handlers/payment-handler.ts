import type { CreatePaymentInput, PaymentMethod } from '../domain/types';

export interface PaymentContext {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  input: CreatePaymentInput;
  now: Date;
}

export type HandlerResult =
  | { kind: 'SUCCEEDED'; details: { cardLast4: string } }
  | { kind: 'PENDING'; details: { qrPayload: string }; succeedAfterSeconds: number };

export interface PaymentHandler {
  readonly method: PaymentMethod;
  validate(input: CreatePaymentInput, now: Date): void;
  initiate(ctx: PaymentContext): HandlerResult;
}

export const PAYMENT_HANDLERS = Symbol('PAYMENT_HANDLERS');
