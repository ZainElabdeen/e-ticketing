import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider, createApi } from '../api/client';
import { stubFetch, type StubRoute } from '../test/render';
import { usePaymentPolling } from './usePaymentPolling';

const pay = (status: string) => ({
  id: 'p-1',
  orderId: 'o-1',
  method: 'QR',
  status,
  amountMinor: 20000,
  currency: 'AED',
  qrPayload: 'eticket:pay:p-1',
});
const get = (responses: StubRoute['responses'], extra: Partial<StubRoute> = {}): StubRoute => ({
  method: 'GET',
  path: '/v1/payments/p-1',
  status: 200,
  responses,
  ...extra,
});
const ok = (status: string) => ({ status: 200, body: pay(status) });

function setup(route: StubRoute, opts?: Parameters<typeof usePaymentPolling>[1]) {
  const fetch = stubFetch([route]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(ApiProvider, {
      api: createApi({ fetch }),
      children: createElement(QueryClientProvider, { client, children }),
    });
  const hook = renderHook(() => usePaymentPolling('p-1', opts), { wrapper });
  return { fetch, hook };
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('usePaymentPolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
  });

  it('polls every second until succeeded', async () => {
    const { fetch, hook } = setup(get([ok('PENDING'), ok('PENDING'), ok('SUCCEEDED')]));
    await advance(0);
    expect(hook.result.current.state).toBe('polling');
    await advance(2100);
    expect(hook.result.current.state).toBe('succeeded');
    expect(fetch.calls).toHaveLength(3);
    await advance(5000);
    expect(fetch.calls).toHaveLength(3);
  });

  it('stops after 60 visible seconds', async () => {
    const { fetch, hook } = setup(get([ok('PENDING')]));
    await advance(59_000);
    expect(hook.result.current.state).toBe('polling');
    await advance(1500);
    expect(hook.result.current.state).toBe('timeout');
    const n = fetch.calls.length;
    await advance(5000);
    expect(fetch.calls).toHaveLength(n);
  });

  it('polling pauses while hidden', async () => {
    const { fetch, hook } = setup(get([ok('PENDING')]));
    await advance(10_000);
    setVisibility('hidden');
    const n = fetch.calls.length;
    await advance(120_000);
    expect(fetch.calls).toHaveLength(n);
    setVisibility('visible');
    await advance(1500);
    expect(hook.result.current.state).toBe('polling');
    expect(fetch.calls.length).toBeGreaterThan(n);
  });

  it('polling survives a 429', async () => {
    const { fetch, hook } = setup(
      get(
        [
          ok('PENDING'),
          { status: 429, body: { code: 'RATE_LIMITED', message: 'x' } },
          ok('PENDING'),
          ok('SUCCEEDED'),
        ],
        {
          headers: { 'Retry-After': '2' },
        },
      ),
    );
    // Retry-After header is applied to every response; harmless on the 200s.
    await advance(1100);
    expect(hook.result.current.reconnecting).toBe(true);
    expect(hook.result.current.payment?.status).toBe('PENDING');
    const afterError = fetch.calls.length;
    await advance(1000);
    expect(fetch.calls).toHaveLength(afterError); // waits at least 2 s
    await advance(1200);
    expect(hook.result.current.reconnecting).toBe(false);
    await advance(1100);
    expect(hook.result.current.state).toBe('succeeded');
  });

  it('keeps polling after a 5xx without dropping data', async () => {
    const { hook } = setup(
      get([
        ok('PENDING'),
        { status: 503, body: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } },
        ok('PENDING'),
      ]),
    );
    await advance(1100);
    expect(hook.result.current.reconnecting).toBe(true);
    expect(hook.result.current.payment).toBeDefined();
    expect(hook.result.current.state).toBe('polling');
    await advance(1100);
    expect(hook.result.current.reconnecting).toBe(false);
  });

  it('polling stops on cancelled', async () => {
    const { fetch, hook } = setup(get([ok('PENDING'), ok('CANCELLED')]));
    await advance(1100);
    expect(hook.result.current.state).toBe('cancelled');
    await advance(5000);
    expect(fetch.calls).toHaveLength(2);
  });

  it('restart resumes after timeout', async () => {
    const { fetch, hook } = setup(get([ok('PENDING')]), { maxVisibleMs: 3000 });
    await advance(3500);
    expect(hook.result.current.state).toBe('timeout');
    const n = fetch.calls.length;
    act(() => hook.result.current.restart());
    await advance(1100);
    expect(hook.result.current.state).toBe('polling');
    expect(fetch.calls.length).toBeGreaterThan(n + 1);
  });
});
