import { DomainError } from '@eticket/nest-common';

export class UnsupportedCurrencyError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
  constructor() {
    super('currency is not supported by the ledger accounts');
  }
}

export class PostingConflictError extends DomainError {
  readonly code = 'POSTING_CONFLICT';
  readonly httpStatus = 409;
  constructor(transactionId: string) {
    super(`transaction ${transactionId} was already posted with different values`);
  }
}

/**
 * An invariant breach inside the ledger, never a client error. A plain Error on
 * purpose: the exception filter answers any non-DomainError with a generic 500
 * and logs it, so this message stays server-side.
 */
export class UnbalancedEntryError extends Error {
  constructor(reason: string) {
    super(`unbalanced journal entry: ${reason}`);
    this.name = 'UnbalancedEntryError';
  }
}
