import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import { correlationIdOf, type CorrelatedRequest } from './correlation-id';

interface RoutedRequest extends IncomingMessage {
  originalUrl?: string;
  route?: { path?: unknown };
}

/** The matched route pattern when there is one, else the URL path without its query. */
function routeOf(req: RoutedRequest): string {
  const pattern = req.route?.path;
  if (typeof pattern === 'string') {
    return pattern;
  }
  return (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
}

/**
 * pino-http options producing the spec §7 line: `timestamp`, `level` (label),
 * `service`, `correlationId`, `method`, `route`, `statusCode`, `durationMs`.
 */
export function pinoHttpOptions(level: string, stream?: DestinationStream): Options {
  const summary = (req: IncomingMessage, res: ServerResponse) => ({
    method: req.method,
    route: routeOf(req as RoutedRequest),
    statusCode: res.statusCode,
  });
  return {
    level,
    ...(stream ? { stream } : {}),
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: { level: (label: string) => ({ level: label }) },
    customAttributeKeys: { responseTime: 'durationMs' },
    // No nested req/res objects: the fields above carry what operators need,
    // and headers (x-api-key) never reach the log.
    quietReqLogger: true,
    quietResLogger: true,
    // correlationIdOf caches per request, so the middleware, the logs and
    // the error body all carry one id whatever the middleware order.
    genReqId: (req) => correlationIdOf(req as CorrelatedRequest),
    customProps: (req) => ({
      service: 'ticket-service',
      correlationId: correlationIdOf(req as CorrelatedRequest),
    }),
    customSuccessObject: (req, res, val) => ({
      ...summary(req, res),
      durationMs: (val as { durationMs: number }).durationMs,
    }),
    customErrorObject: (req, res, err, val) => ({
      ...summary(req, res),
      durationMs: (val as { durationMs: number }).durationMs,
      err,
    }),
    redact: ['req.headers["x-api-key"]', 'req.headers.authorization'],
  };
}
