import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { Payment } from '../api/types';

export type PollState = 'polling' | 'succeeded' | 'cancelled' | 'timeout';

const TICK_MS = 250;

export const paymentKey = (paymentId: string) => ['payment', paymentId] as const;

/**
 * Polls `GET /v1/payments/{id}`. The cap counts only time the tab is visible: an accumulator is
 * advanced by a short tick and by `visibilitychange`, and stays put while the tab is hidden.
 * Errors keep the last payment, flag `reconnecting` and keep polling (a 429 waits for Retry-After).
 */
export function usePaymentPolling(
  paymentId: string,
  opts: { intervalMs?: number; maxVisibleMs?: number } = {},
): { payment?: Payment; state: PollState; reconnecting: boolean; restart: () => void } {
  const { intervalMs = 1000, maxVisibleMs = 60_000 } = opts;
  const api = useApi();
  const [timedOut, setTimedOut] = useState(false);
  const [epoch, setEpoch] = useState(0);

  const query = useQuery({
    queryKey: paymentKey(paymentId),
    queryFn: () => call(api.GET('/v1/payments/{paymentId}', { params: { path: { paymentId } } })),
    retry: false,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (timedOut || status === 'SUCCEEDED' || status === 'CANCELLED') return false;
      // A first load that fails (e.g. 404) has nothing to keep polling for.
      if (q.state.data === undefined && q.state.error) return false;
      const err = q.state.error;
      if (err instanceof ApiError && err.status === 429 && err.retryAfterSeconds) {
        return Math.max(intervalMs, err.retryAfterSeconds * 1000);
      }
      return intervalMs;
    },
  });

  const status = query.data?.status;
  const state: PollState =
    status === 'SUCCEEDED'
      ? 'succeeded'
      : status === 'CANCELLED'
        ? 'cancelled'
        : timedOut
          ? 'timeout'
          : 'polling';

  const active = state === 'polling';
  const visibleMs = useRef(0);
  useEffect(() => {
    if (!active) return;
    visibleMs.current = 0;
    let since: number | null = document.visibilityState === 'visible' ? Date.now() : null;
    const accrue = (): void => {
      const now = Date.now();
      if (since !== null) visibleMs.current += now - since;
      since = document.visibilityState === 'visible' ? now : null;
      if (visibleMs.current >= maxVisibleMs) setTimedOut(true);
    };
    const id = setInterval(accrue, TICK_MS);
    document.addEventListener('visibilitychange', accrue);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', accrue);
    };
  }, [active, maxVisibleMs, epoch]);

  const { refetch } = query;
  const restart = useCallback(() => {
    setTimedOut(false);
    setEpoch((e) => e + 1);
    void refetch();
  }, [refetch]);

  return {
    ...(query.data ? { payment: query.data } : {}),
    state,
    reconnecting: query.isError,
    restart,
  };
}
