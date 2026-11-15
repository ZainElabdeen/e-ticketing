import type { Api } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { CreatePaymentBody, Payment } from '../api/types';

export const newIdempotencyKey = (): string => crypto.randomUUID();

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
