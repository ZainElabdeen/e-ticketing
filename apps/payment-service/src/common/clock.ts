export const CLOCK = Symbol('CLOCK');

/** Injectable time source for the card-expiry check and the payment-reference date. */
export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
