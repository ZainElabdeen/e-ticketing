import type { PaymentMethod } from '../domain/types';
import type { PaymentHandler } from './payment-handler';

export class HandlerRegistry {
  private readonly byMethod = new Map<PaymentMethod, PaymentHandler>();

  constructor(handlers: PaymentHandler[]) {
    for (const handler of handlers) {
      if (this.byMethod.has(handler.method)) {
        throw new Error(`duplicate payment handler for method ${handler.method}`);
      }
      this.byMethod.set(handler.method, handler);
    }
  }

  get(method: PaymentMethod): PaymentHandler {
    const handler = this.byMethod.get(method);
    if (!handler) throw new Error(`no payment handler for method ${method}`);
    return handler;
  }
}
