import { DomainError } from '@eticket/nest-common';

export class UnsupportedCurrencyError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
  constructor(currency: string) {
    super(`currency ${currency} is not supported by the ledger accounts`);
  }
}

export class PostingConflictError extends DomainError {
  readonly code = 'POSTING_CONFLICT';
  readonly httpStatus = 409;
  constructor(transactionId: string) {
    super(`transaction ${transactionId} was already posted with different values`);
  }
}

/** An invariant breach inside the ledger, never a client error. */
export class UnbalancedEntryError extends DomainError {
  readonly code = 'INTERNAL_ERROR';
  readonly httpStatus = 500;
  constructor(reason: string) {
    super(`unbalanced journal entry: ${reason}`);
  }
}
