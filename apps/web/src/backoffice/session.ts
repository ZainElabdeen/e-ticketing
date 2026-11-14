import { safeSession } from '../lib/storage';

const KEY = 'eticket.backoffice.session';

export type Session = { token: string; expiresAt: number };

// The memory copy is the source of truth; sessionStorage only survives a reload of the tab.
let memory: Session | null = null;

export function saveSession(
  token: string,
  expiresInSeconds: number,
  now: () => number = Date.now,
): void {
  memory = { token, expiresAt: now() + expiresInSeconds * 1000 };
  safeSession.set(KEY, JSON.stringify(memory));
}

export function clearSession(): void {
  memory = null;
  safeSession.remove(KEY);
}

function parse(raw: string | null): Session | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Partial<Session> | null;
    if (v && typeof v.token === 'string' && typeof v.expiresAt === 'number') {
      return { token: v.token, expiresAt: v.expiresAt };
    }
  } catch {
    // Corrupted value: treated as no session.
  }
  return null;
}

/** The live session, or null. An expired or corrupted session is cleared. */
export function loadSession(now: () => number = Date.now): Session | null {
  const session = memory ?? parse(safeSession.get(KEY));
  if (!session || session.expiresAt <= now()) {
    clearSession();
    return null;
  }
  memory = session;
  return session;
}

export function getSessionToken(): string | null {
  return loadSession()?.token ?? null;
}
