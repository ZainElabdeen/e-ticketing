const UNIQUE_VIOLATION = '23505';

interface DriverError {
  code?: unknown;
  constraint?: unknown;
  message?: unknown;
  cause?: unknown;
  meta?: unknown;
}

/** Walks `err` and its `cause` chain, the way Prisma wraps driver errors. */
function* chain(err: unknown): Generator<DriverError> {
  let current = err;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const e: DriverError = current;
    yield e;
    current = e.cause;
  }
}

/**
 * True when `err` is a unique violation on the named constraint. Covers Prisma's
 * P2002 and Postgres 23505 from a raw query, whichever way the adapter wraps it.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (const e of chain(err)) {
    const isUnique = e.code === 'P2002' || e.code === UNIQUE_VIOLATION;
    if (!isUnique) continue;
    if (e.constraint === constraint) return true;
    const text = JSON.stringify(e.meta ?? {}) + (typeof e.message === 'string' ? e.message : '');
    if (text.includes(constraint)) return true;
  }
  return false;
}
