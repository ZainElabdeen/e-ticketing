import { DomainError } from '@eticket/nest-common';

export class OrderNotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly httpStatus = 404;
  constructor(orderId: string) {
    super(`Order ${orderId} not found`);
  }
}

export class QuotaExceededError extends DomainError {
  readonly code = 'QUOTA_EXCEEDED';
  readonly httpStatus = 409;
  constructor(ticketTypeCode: string) {
    super(`Not enough ${ticketTypeCode} tickets available`);
  }
}

export class OrderNotConfirmableError extends DomainError {
  readonly code = 'ORDER_NOT_CONFIRMABLE';
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message);
  }
}
