import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The slice of an Express request/response these helpers need. */
export interface CorrelatedRequest {
  headers: Record<string, string | string[] | undefined>;
  correlationId?: string;
}
export interface HeaderSetter {
  setHeader(name: string, value: string): unknown;
}

/**
 * Resolves the request's correlation ID once and caches it on the request, so
 * the middleware, the logger and the error filter always see the same value.
 * A header value that is not a UUID is discarded (it would end up in logs).
 */
export function correlationIdOf(req: CorrelatedRequest): string {
  if (req.correlationId) {
    return req.correlationId;
  }
  const raw = req.headers[CORRELATION_HEADER];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  req.correlationId = candidate && UUID.test(candidate) ? candidate : randomUUID();
  return req.correlationId;
}

/** Express middleware: resolves the ID and echoes it as a response header. */
export function correlationIdMiddleware(
  req: CorrelatedRequest,
  res: HeaderSetter,
  next: () => void,
): void {
  res.setHeader(CORRELATION_HEADER, correlationIdOf(req));
  next();
}
