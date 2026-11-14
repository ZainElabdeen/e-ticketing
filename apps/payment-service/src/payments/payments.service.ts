import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { isUniqueViolation } from '@eticket/nest-common';
import { CLOCK, type Clock } from '../common/clock';
import { TicketClient } from '../downstream/ticket.client';
import {
  IdempotencyKeyReuseError,
  OrderAlreadyPaidError,
  OrderNotFoundError,
  OrderNotPayableError,
  PaymentInProgressError,
  PaymentNotCancellableError,
  PaymentNotFoundError,
} from './domain/errors';
import { requestHash } from './domain/request-hash';
import type { CreatePaymentInput } from './domain/types';
import { HandlerRegistry } from './handlers/handler-registry';
import type { PaymentHandler } from './handlers/payment-handler';
import type { PaymentView } from './payment.view';
import { PaymentsRepository } from './payments.repository';

export type CreateResult = { view: PaymentView; replayed: boolean };

const LIVE_PAYMENT_INDEX = 'payments_one_live_per_order';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly repo: PaymentsRepository,
    private readonly registry: HandlerRegistry,
    private readonly ticket: TicketClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Spec §4.2: the DTO has validated the body (400); then the key pre-read (a
   * stored response always wins), the handler's checks, the order read and one
   * DB transaction.
   */
  async create(
    input: CreatePaymentInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<CreateResult> {
    const hash = requestHash(input);
    const stored = await this.repo.findKey(idempotencyKey);
    if (stored && stored.responseStatus !== null) {
      if (stored.requestHash !== hash) throw new IdempotencyKeyReuseError('idempotency key reuse');
      return { view: stored.responseBody as PaymentView, replayed: true };
    }

    const handler = this.registry.get(input.method);
    handler.validate(input, this.clock.now());

    // One retry: when the live payment that blocked us was cancelled in between,
    // the order may be payable again, so read it afresh.
    for (let attempt = 1; ; attempt++) {
      const outcome = await this.attempt(input, handler, idempotencyKey, hash, correlationId);
      if (outcome !== 'LIVE_PAYMENT_GONE' || attempt >= 2) {
        if (outcome === 'LIVE_PAYMENT_GONE') {
          throw new PaymentInProgressError('a payment is already in progress');
        }
        return outcome;
      }
    }
  }

  /** The order read onward. 'LIVE_PAYMENT_GONE' means a conflict whose blocker has vanished. */
  private async attempt(
    input: CreatePaymentInput,
    handler: PaymentHandler,
    idempotencyKey: string,
    hash: string,
    correlationId: string,
  ): Promise<CreateResult | 'LIVE_PAYMENT_GONE'> {
    const order = await this.ticket.getOrder(input.orderId, correlationId);
    if (!order) throw new OrderNotFoundError('order not found');
    if (order.status !== 'PENDING' || Date.parse(order.expiresAt) <= this.clock.now().getTime()) {
      throw new OrderNotPayableError('order is not payable');
    }

    const now = this.clock.now();
    const paymentId = randomUUID();
    const result = handler.initiate({
      paymentId,
      orderId: order.id,
      amountMinor: order.totalMinor,
      currency: order.currency,
      input,
      now,
    });

    try {
      const created = await this.repo.createWithKey({
        key: idempotencyKey,
        requestHash: hash,
        paymentId,
        order,
        method: input.method,
        result,
        correlationId,
        now,
      });
      switch (created.kind) {
        case 'CREATED':
          return { view: created.view, replayed: false };
        case 'REPLAY':
          return { view: created.body as PaymentView, replayed: true };
        case 'KEY_REUSE':
          throw new IdempotencyKeyReuseError('idempotency key reuse');
      }
    } catch (err) {
      if (isUniqueViolation(err, LIVE_PAYMENT_INDEX)) {
        const live = await this.repo.liveStatusFor(order.id);
        if (live === 'PENDING') {
          throw new PaymentInProgressError('a payment is already in progress');
        }
        if (live === 'SUCCEEDED') throw new OrderAlreadyPaidError('the order is already paid');
        return 'LIVE_PAYMENT_GONE';
      }
      throw err;
    }
  }

  async get(paymentId: string): Promise<PaymentView> {
    const view = await this.repo.findView(paymentId);
    if (!view) throw new PaymentNotFoundError('payment not found');
    return view;
  }

  async cancel(paymentId: string): Promise<PaymentView> {
    const result = await this.repo.cancel(paymentId);
    if (result === 'NOT_FOUND') throw new PaymentNotFoundError('payment not found');
    if (result === 'NOT_CANCELLABLE') {
      throw new PaymentNotCancellableError('only a PENDING payment can be cancelled');
    }
    return result;
  }
}
