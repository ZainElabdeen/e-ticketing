/** A business-rule failure that maps to a specific HTTP status and envelope code. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
}
