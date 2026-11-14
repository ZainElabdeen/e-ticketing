import { BadRequestException, Logger } from '@nestjs/common';
import { correlationIdOf, type CorrelatedRequest } from './correlation-id';

const logger = new Logger('JsonParseError');

interface ParseFailure {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

/** body-parser's JSON failure: `entity.parse.failed`, or a SyntaxError carrying a 400. */
export function isJsonParseFailure(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const e = err as ParseFailure;
  if (e.type === 'entity.parse.failed') {
    return true;
  }
  return err instanceof SyntaxError && (e.status === 400 || e.statusCode === 400);
}

export const MALFORMED_JSON_MESSAGE = 'Malformed JSON body';

/**
 * Express error middleware for the line after body parsing. V8's JSON message
 * quotes about ten characters of the source, which can be a card's CVC, so the
 * original error is replaced and never reaches the filter or the logs.
 */
export function jsonParseErrorMiddleware(
  err: unknown,
  req: CorrelatedRequest,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  if (!isJsonParseFailure(err)) {
    next(err);
    return;
  }
  // Runs before pino-http, so nothing else records this request. Fixed text and no
  // parser message: the body can hold a card number.
  logger.warn({ correlationId: correlationIdOf(req), statusCode: 400 }, 'malformed request body');
  next(new BadRequestException(MALFORMED_JSON_MESSAGE));
}
