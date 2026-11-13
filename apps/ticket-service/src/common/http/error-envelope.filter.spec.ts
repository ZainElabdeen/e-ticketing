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
import {
  OrderNotConfirmableError,
  OrderNotFoundError,
  QuotaExceededError,
} from '../../orders/domain/errors';
import { ErrorEnvelopeFilter } from './error-envelope.filter';

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
    ['OrderNotFoundError', new OrderNotFoundError('o1'), 404, 'NOT_FOUND'],
    ['QuotaExceededError', new QuotaExceededError('GOLD'), 409, 'QUOTA_EXCEEDED'],
    [
      'OrderNotConfirmableError',
      new OrderNotConfirmableError('nope'),
      409,
      'ORDER_NOT_CONFIRMABLE',
    ],
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

  it('names the ticket type in a quota message', () => {
    const { json } = run(new QuotaExceededError('GOLD'));
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

  it.each([413, 429])('keeps status %i as BAD_REQUEST and logs a warning', (code) => {
    const { status, json } = run(new HttpException('nope', code));
    expect(status).toHaveBeenCalledWith(code);
    expect(json.mock.calls[0]?.[0]).toMatchObject({ statusCode: code, code: 'BAD_REQUEST' });
    expect(logWarn).toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
  });

  it('does not treat /healthcheck as health', () => {
    const { json } = run(new ServiceUnavailableException('x'), '/healthcheck');
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('passes the health 503 body through unchanged', () => {
    const body = { status: 'error', error: { database: { status: 'down' } } };
    const { status, json } = run(new ServiceUnavailableException(body), '/health/ready');
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(body);
  });
});
