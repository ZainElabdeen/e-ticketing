import {
  BadRequestException,
  type ArgumentsHost,
  HttpException,
  Logger,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DomainError } from './domain-error';
import { ErrorEnvelopeFilter } from './error-envelope.filter';

class ThingMissingError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
}
class QuotaError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  readonly httpStatus = 409;
  constructor(kind: string) {
    super(`No ${kind} left`);
  }
}
class NotConfirmableError extends DomainError {
  readonly code = 'ORDER_NOT_CONFIRMABLE';
  readonly httpStatus = 409;
}

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

function run(exception: unknown, path = '/v1/orders') {
  const json = jest.fn<void, [{ message: string }]>();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ path, headers: {}, correlationId: ID }),
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  new ErrorEnvelopeFilter().catch(exception, host);
  return { status, json };
}

describe('ErrorEnvelopeFilter', () => {
  let logError: jest.SpyInstance;
  let logWarn: jest.SpyInstance;
  beforeEach(() => {
    logWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['a 404 DomainError', new ThingMissingError('o1'), 404, 'NOT_FOUND'],
    ['a 409 DomainError', new QuotaError('GOLD'), 409, 'QUOTA_EXCEEDED'],
    ['another 409 DomainError', new NotConfirmableError('nope'), 409, 'ORDER_NOT_CONFIRMABLE'],
    ['BadRequestException', new BadRequestException(['a bad', 'b bad']), 400, 'VALIDATION_ERROR'],
    ['UnauthorizedException', new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    ['ForbiddenException', new ForbiddenException(), 403, 'FORBIDDEN'],
    ['NotFoundException', new NotFoundException(), 404, 'NOT_FOUND'],
  ])('maps %s', (_name, error, statusCode, code) => {
    const { status, json } = run(error);
    expect(status).toHaveBeenCalledWith(statusCode);
    expect(Object.keys(json.mock.calls[0]?.[0] ?? {}).sort()).toEqual([
      'code',
      'correlationId',
      'message',
      'statusCode',
    ]);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ statusCode, code, correlationId: ID });
  });

  it('uses the DomainError message', () => {
    const { json } = run(new QuotaError('GOLD'));
    expect(json.mock.calls[0]?.[0].message).toContain('GOLD');
  });

  it('joins validator messages', () => {
    const { json } = run(new BadRequestException(['a bad', 'b bad']));
    expect(json.mock.calls[0]?.[0].message).toBe('a bad; b bad');
  });

  it('hides internals of an unknown error', () => {
    const { status, json } = run(new Error('secret connection string'));
    expect(logError).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      correlationId: ID,
    });
  });

  it.each([
    [413, 'PAYLOAD_TOO_LARGE'],
    [415, 'UNSUPPORTED_MEDIA_TYPE'],
    [429, 'RATE_LIMITED'],
    [405, 'BAD_REQUEST'],
    [422, 'BAD_REQUEST'],
  ])('keeps HttpException status %i as %s and logs a warning', (code, envelopeCode) => {
    const { status, json } = run(new HttpException('nope', code));
    expect(status).toHaveBeenCalledWith(code);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ statusCode: code, code: envelopeCode });
    expect(logWarn).toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('keeps an http-errors client error (body-parser 413) instead of a 500', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { status, json } = run(tooLarge);
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'request entity too large',
      correlationId: ID,
    });
    expect(logWarn).toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('maps an http-errors 415 and an unmapped 400-range one', () => {
    const unsupported = Object.assign(new Error('unsupported charset'), {
      status: 415,
      expose: true,
    });
    expect(run(unsupported).json.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    });
    const aborted = Object.assign(new Error('request aborted'), { statusCode: 400, expose: true });
    expect(run(aborted).json.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  });

  it('does not trust a 4xx-looking error that is not exposable', () => {
    const { status } = run(Object.assign(new Error('x'), { status: 400, expose: false }));
    expect(status).toHaveBeenCalledWith(500);
  });

  it('does not treat /healthcheck as health', () => {
    const { json } = run(new ServiceUnavailableException('x'), '/healthcheck');
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it.each(['/health', '/health/other', '/health/live/x'])(
    'gives %s the normal envelope',
    (path) => {
      const { json } = run(new ServiceUnavailableException('x'), path);
      expect(json.mock.calls[0]?.[0]).toMatchObject({ statusCode: 500, code: 'INTERNAL_ERROR' });
    },
  );

  it('passes the health 503 body through unchanged', () => {
    const body = { status: 'error', error: { database: { status: 'down' } } };
    const { status, json } = run(new ServiceUnavailableException(body), '/health/ready');
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(body);
    expect(run(new ServiceUnavailableException(body), '/health/live').status).toHaveBeenCalledWith(
      503,
    );
  });
});
