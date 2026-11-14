import { DomainError } from '@eticket/nest-common';

export class InvalidCardError extends DomainError {
  readonly code = 'INVALID_CARD';
  readonly httpStatus = 422;
}
export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;
}
export class OrderNotPayableError extends DomainError {
  readonly code = 'ORDER_NOT_PAYABLE';
  readonly httpStatus = 409;
}
export class PaymentInProgressError extends DomainError {
  readonly code = 'PAYMENT_IN_PROGRESS';
  readonly httpStatus = 409;
}
export class OrderAlreadyPaidError extends DomainError {
  readonly code = 'ORDER_ALREADY_PAID';
  readonly httpStatus = 409;
}
export class PaymentNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
}
export class PaymentNotCancellableError extends DomainError {
  readonly code = 'PAYMENT_NOT_CANCELLABLE';
  readonly httpStatus = 409;
}
export class IdempotencyKeyReuseError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSE';
  readonly httpStatus = 422;
}
export class UpstreamUnavailableError extends DomainError {
  readonly code = 'UPSTREAM_UNAVAILABLE';
  readonly httpStatus = 502;

  /**
   * @param status the downstream's HTTP status when it answered with an unexpected one;
   * undefined for a transport failure (no response). Kept off the message on purpose.
   */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export class UpstreamTimeoutError extends DomainError {
  readonly code = 'UPSTREAM_TIMEOUT';
  readonly httpStatus = 504;
}
