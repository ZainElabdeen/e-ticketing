import { DomainError } from '@eticket/nest-common';

export class UpstreamUnavailableError extends DomainError {
  readonly code = 'UPSTREAM_UNAVAILABLE';
  readonly httpStatus = 502;
}

export class UpstreamTimeoutError extends DomainError {
  readonly code = 'UPSTREAM_TIMEOUT';
  readonly httpStatus = 504;
}
