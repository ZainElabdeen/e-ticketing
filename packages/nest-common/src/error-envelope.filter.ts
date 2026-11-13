import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  ForbiddenException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DomainError } from './domain-error';
import { correlationIdOf, type CorrelatedRequest } from './correlation-id';

interface FilterRequest extends CorrelatedRequest {
  path?: string;
  url?: string;
}
interface FilterResponse {
  status(code: number): { json(body: unknown): unknown };
}

const HEALTH_PATHS = new Set(['/health/live', '/health/ready']);

function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const message = (body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
}

const GENERIC_CLIENT_CODES: Record<number, string> = {
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function genericCode(status: number): string {
  return GENERIC_CLIENT_CODES[status] ?? 'BAD_REQUEST';
}

/**
 * Body-parser and other http-errors objects reach the filter as plain Errors
 * (Nest only converts SyntaxError/URIError). A 4xx with `expose === true` is
 * safe to show and keeps its status.
 */
function exposedClientStatus(exception: unknown): number | undefined {
  if (!(exception instanceof Error) || exception instanceof HttpException) {
    return undefined;
  }
  const e = exception as { status?: unknown; statusCode?: unknown; expose?: unknown };
  const status = typeof e.status === 'number' ? e.status : e.statusCode;
  if (typeof status === 'number' && status >= 400 && status <= 499 && e.expose === true) {
    return status;
  }
  return undefined;
}

/** Turns every error into `{ statusCode, code, message, correlationId }`. */
@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorEnvelopeFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FilterRequest>();
    const res = http.getResponse<FilterResponse>();
    const correlationId = correlationIdOf(req);
    const path = req.path ?? (req.url ?? '').split('?')[0] ?? '';

    // Health is exempt from the envelope: Terminus's own 503 body is the contract.
    if (exception instanceof HttpException && HEALTH_PATHS.has(path)) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const { statusCode, code, message } = this.classify(exception, correlationId);
    res.status(statusCode).json({ statusCode, code, message, correlationId });
  }

  private classify(
    exception: unknown,
    correlationId: string,
  ): { statusCode: number; code: string; message: string } {
    if (exception instanceof DomainError) {
      return { statusCode: exception.httpStatus, code: exception.code, message: exception.message };
    }
    if (exception instanceof BadRequestException) {
      return { statusCode: 400, code: 'VALIDATION_ERROR', message: messageOf(exception) };
    }
    if (exception instanceof UnauthorizedException) {
      return { statusCode: 401, code: 'UNAUTHORIZED', message: messageOf(exception) };
    }
    if (exception instanceof ForbiddenException) {
      return { statusCode: 403, code: 'FORBIDDEN', message: messageOf(exception) };
    }
    if (exception instanceof NotFoundException) {
      return { statusCode: 404, code: 'NOT_FOUND', message: messageOf(exception) };
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      // e.g. 405, 413, 429: keep the status, never leak a stack.
      this.logger.warn({ correlationId }, exception.message);
      return {
        statusCode: exception.getStatus(),
        code: genericCode(exception.getStatus()),
        message: messageOf(exception),
      };
    }
    const clientStatus = exposedClientStatus(exception);
    if (clientStatus !== undefined) {
      const message = (exception as Error).message;
      this.logger.warn({ correlationId }, message);
      return { statusCode: clientStatus, code: genericCode(clientStatus), message };
    }
    const stack = exception instanceof Error ? exception.stack : String(exception);
    this.logger.error({ correlationId }, stack);
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }
}
