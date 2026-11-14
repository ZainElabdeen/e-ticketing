import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountdown } from './useCountdown';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('useCountdown', () => {
  it('ticks down to zero and flags expiry', () => {
    const { result } = renderHook(() => useCountdown('2026-11-14T10:00:03Z'));
    expect(result.current).toEqual({ remainingMs: 3000, expired: false });
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.remainingMs).toBe(2000);
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current).toEqual({ remainingMs: 0, expired: true });
  });
  it('is expired immediately for a past time', () => {
    const { result } = renderHook(() => useCountdown('2026-11-14T09:00:00Z'));
    expect(result.current.expired).toBe(true);
  });
});
