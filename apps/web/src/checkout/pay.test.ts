import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createApi } from '../api/client';
import { stubFetch } from '../test/render';
import { newIdempotencyKey, submitPayment } from './pay';

const payment = { id: 'p-1', orderId: 'o-1', method: 'QR', status: 'PENDING' };
const body = { orderId: 'o-1', method: 'QR' as const };
const err = (status: number, code: string) => ({
  status,
  body: { statusCode: status, code, message: code },
});

function setup(responses: Array<{ status: number; body?: unknown }>) {
  const fetch = stubFetch([{ method: 'POST', path: '/v1/payments', status: 201, responses }]);
  const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
  return { api: createApi({ fetch }), fetch, sleep };
}
const keys = (calls: Request[]): Array<string | null> =>
  calls.map((c) => c.headers.get('idempotency-key'));

describe('submitPayment', () => {
  it('sends the key once on success', async () => {
    const { api, fetch, sleep } = setup([{ status: 201, body: payment }]);
    const r = await submitPayment(api, body, 'k1', { sleep });
    expect(r.payment.id).toBe('p-1');
    expect(r.key).toBe('k1');
    expect(keys(fetch.calls)).toEqual(['k1']);
  });
  it('retries a 5xx with the same key after 500 ms', async () => {
    const { api, fetch, sleep } = setup([
      err(503, 'UPSTREAM_UNAVAILABLE'),
      { status: 201, body: payment },
    ]);
    await submitPayment(api, body, 'k1', { sleep });
    expect(keys(fetch.calls)).toEqual(['k1', 'k1']);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
  });
  it('retries a network error and a 502 with sleeps 500 then 1000', async () => {
    const inner = stubFetch([
      {
        method: 'POST',
        path: '/v1/payments',
        status: 201,
        responses: [err(502, 'UPSTREAM_UNAVAILABLE'), { status: 201, body: payment }],
      },
    ]);
    let first = true;
    const flaky = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (first) {
          first = false;
          inner.calls.push(input as Request);
          return Promise.reject(new TypeError('offline'));
        }
        return inner(input, init);
      },
      { calls: inner.calls },
    ) as unknown as typeof fetch;
    const sleep = vi.fn<(ms: number) => Promise<void>>(() => Promise.resolve());
    await submitPayment(createApi({ fetch: flaky }), body, 'k1', { sleep });
    expect(keys(inner.calls)).toEqual(['k1', 'k1', 'k1']);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });
  it('throws the last 5xx after three calls', async () => {
    const { api, fetch, sleep } = setup([err(502, 'UPSTREAM_UNAVAILABLE')]);
    await expect(submitPayment(api, body, 'k1', { sleep })).rejects.toMatchObject({ status: 502 });
    expect(fetch.calls).toHaveLength(3);
  });
  it('makes one new key on IDEMPOTENCY_KEY_REUSE', async () => {
    const { api, fetch, sleep } = setup([
      err(422, 'IDEMPOTENCY_KEY_REUSE'),
      { status: 201, body: payment },
    ]);
    const r = await submitPayment(api, body, 'k1', { sleep });
    const sent = keys(fetch.calls);
    expect(sent[0]).toBe('k1');
    expect(sent[1]).not.toBe('k1');
    expect(r.key).toBe(sent[1]);
  });
  it('does not retry a 409', async () => {
    const { api, fetch, sleep } = setup([err(409, 'PAYMENT_IN_PROGRESS')]);
    const e = await submitPayment(api, body, 'k1', { sleep }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe('PAYMENT_IN_PROGRESS');
    expect(fetch.calls).toHaveLength(1);
  });
  it('generates UUID keys', () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe('newIdempotencyKey', () => {
  it('falls back to a v4 UUID when crypto.randomUUID is missing (insecure origin)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const a = newIdempotencyKey();
      const b = newIdempotencyKey();
      const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
      expect(a).toMatch(v4);
      expect(b).toMatch(v4);
      expect(a).not.toBe(b);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
