import { safeSession } from '../lib/storage';

export type RememberedPayment = { paymentId: string; method: 'CARD' | 'QR' };

const keyFor = (orderId: string): string => `eticket.payment.${orderId}`;

/** Remembers only the payment id and method, never card data. */
export function rememberPayment(orderId: string, p: RememberedPayment): void {
  safeSession.set(keyFor(orderId), JSON.stringify({ paymentId: p.paymentId, method: p.method }));
}

export function recallPayment(orderId: string): RememberedPayment | null {
  const raw = safeSession.get(keyFor(orderId));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<RememberedPayment> | null;
    if (v && typeof v.paymentId === 'string' && (v.method === 'CARD' || v.method === 'QR')) {
      return { paymentId: v.paymentId, method: v.method };
    }
  } catch {
    // Corrupted entry: treat as no memory.
  }
  return null;
}

export function forgetPayment(orderId: string): void {
  safeSession.remove(keyFor(orderId));
}
