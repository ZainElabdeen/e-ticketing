import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, loadSession, saveSession } from './session';

const KEY = 'eticket.backoffice.session';

describe('session', () => {
  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it('keeps a session until it expires, then clears it', () => {
    saveSession('t', 3600, () => 0);
    expect(loadSession(() => 3_599_000)).toEqual({ token: 't', expiresAt: 3_600_000 });
    expect(loadSession(() => 3_600_000)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it('stores only token and expiresAt in sessionStorage', () => {
    saveSession('t', 60, () => 0);
    expect(JSON.parse(window.sessionStorage.getItem(KEY) ?? '{}')).toEqual({
      token: 't',
      expiresAt: 60_000,
    });
    expect(window.localStorage.length).toBe(0);
  });

  it('restores from sessionStorage when memory is empty', () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ token: 'abc', expiresAt: 5000 }));
    expect(loadSession(() => 1000)?.token).toBe('abc');
  });

  it('treats corrupted JSON as no session', () => {
    window.sessionStorage.setItem(KEY, '{nope');
    expect(loadSession(() => 0)).toBeNull();
  });

  it('still works in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    saveSession('t', 60, () => 0);
    expect(loadSession(() => 1000)?.token).toBe('t');
  });
});
