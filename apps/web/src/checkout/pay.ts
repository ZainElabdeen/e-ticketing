import type { Api } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { CreatePaymentBody, Payment } from '../api/types';

// randomUUID exists only in secure contexts; plain http://<LAN-IP> needs the fallback.
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const RETRY_DELAYS_MS = [500, 1000];
const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const retryable = (e: ApiError): boolean => e.code === 'NETWORK_ERROR' || e.status >= 500;

/**
 * Creates a payment (spec §5 key lifecycle). Network errors and 5xx retry with the same key,
 * IDEMPOTENCY_KEY_REUSE resubmits once with a fresh key, anything else is thrown unchanged.
 */
export async function submitPayment(
  api: Api,
  body: CreatePaymentBody,
  key: string,
  opts: {
    sleep?: (ms: number) => Promise<void>;
    /** Called whenever the key in use changes, so the caller keeps the key actually sent. */
    onKey?: (key: string) => void;
  } = {},
): Promise<{ payment: Payment; key: string }> {
  const sleep = opts.sleep ?? realSleep;
  const send = (k: string): Promise<Payment> =>
    call(api.POST('/v1/payments', { params: { header: { 'Idempotency-Key': k } }, body }));

  let currentKey = key;
  let reused = false;
  let retries = 0;
  for (;;) {
    try {
      return { payment: await send(currentKey), key: currentKey };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.code === 'IDEMPOTENCY_KEY_REUSE' && !reused) {
        reused = true;
        currentKey = newIdempotencyKey();
        opts.onKey?.(currentKey);
        continue;
      }
      const delay = RETRY_DELAYS_MS[retries];
      if (retryable(e) && delay !== undefined) {
        retries += 1;
        await sleep(delay);
        continue;
      }
      throw e;
    }
  }
}
