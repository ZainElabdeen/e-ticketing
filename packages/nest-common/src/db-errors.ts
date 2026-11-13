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

/** True when `name` appears in `text` as a whole identifier, so `foo_key` does not match `foo_key2`. */
function mentionsExactly(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);
}

/**
 * True when `err` is a unique violation on the named constraint. Covers Prisma's
 * P2002 and Postgres 23505 from a raw query, whichever way the adapter wraps it.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  for (const e of chain(err)) {
    const text =
      JSON.stringify(e.meta ?? {}) + ' ' + (typeof e.message === 'string' ? e.message : '');
    // $executeRaw/$queryRaw wrap a driver 23505 as P2010 with the SQLSTATE in meta/message.
    const isUnique =
      e.code === 'P2002' ||
      e.code === UNIQUE_VIOLATION ||
      (e.code === 'P2010' && text.includes(UNIQUE_VIOLATION));
    if (!isUnique) continue;
    if (e.constraint === constraint) return true;
    if (mentionsExactly(text, constraint)) return true;
  }
  return false;
}
