import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { RunningPaymentService } from './app';

export const PAN = '4242424242424242';
export const CVC = '987';

export function validCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: PAN,
    expMonth: 12,
    expYear: 2099,
    cvc: CVC,
    holder: 'Ada Lovelace',
    ...overrides,
  };
}

export function cardBody(orderId: string, card: Record<string, unknown> = validCard()) {
  return { orderId, method: 'CARD', card };
}

export function qrBody(orderId: string) {
  return { orderId, method: 'QR' };
}

export function newKey(): string {
  return `key-${randomUUID()}`;
}

/** A response with `body` typed loosely: supertest types it `any`. */
export interface Reply {
  status: number;
  headers: Record<string, string | undefined>;
  text: string;
  body: PaymentReply;
}

export interface PaymentReply {
  id: string;
  orderId: string;
  status: string;
  code: string;
  transaction?: { transactionId: string; paymentReference: string; createdAt: string };
  [field: string]: unknown;
}

function toReply(res: request.Response): Reply {
  return {
    status: res.status,
    headers: res.headers,
    text: res.text,
    body: res.body as PaymentReply,
  };
}

export async function postPayment(
  svc: RunningPaymentService,
  body: unknown,
  key: string | null = newKey(),
  headers: Record<string, string> = {},
): Promise<Reply> {
  const req = request(svc.baseUrl).post('/v1/payments').set('X-Api-Key', svc.publicKey);
  if (key !== null) req.set('Idempotency-Key', key);
  return toReply(await req.set(headers).send(body as object));
}

export async function getPayment(svc: RunningPaymentService, id: string): Promise<Reply> {
  return toReply(
    await request(svc.baseUrl).get(`/v1/payments/${id}`).set('X-Api-Key', svc.publicKey),
  );
}
