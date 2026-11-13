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
import { DomainError } from '../../orders/domain/errors';
import { correlationIdOf, type CorrelatedRequest } from './correlation-id';

interface FilterRequest extends CorrelatedRequest {
  path?: string;
  url?: string;
}
interface FilterResponse {
  status(code: number): { json(body: unknown): unknown };
}

const HEALTH_PREFIX = '/health';

function messageOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const message = (body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join('; ') : (message ?? exception.message);
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
    if (exception instanceof HttpException && path.startsWith(HEALTH_PREFIX)) {
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
    const stack = exception instanceof Error ? exception.stack : String(exception);
    this.logger.error({ correlationId }, stack);
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
  }
}
