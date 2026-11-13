import { Injectable } from '@nestjs/common';
import { toMinor } from '@eticket/nest-common';
import { PrismaService } from '../common/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { TicketOrder } from '../downstream/ticket.client';
import { newPaymentReference } from './domain/payment-reference';
import type { PaymentMethod } from './domain/types';
import type { HandlerResult } from './handlers/payment-handler';
import { toView, type PaymentRow, type PaymentView } from './payment.view';

export type Tx = Prisma.TransactionClient;

export type CreateWithKeyResult =
  | { kind: 'CREATED'; view: PaymentView }
  | { kind: 'REPLAY'; body: unknown }
  | { kind: 'KEY_REUSE' };

export interface CreateWithKeyArgs {
  key: string;
  requestHash: string;
  paymentId: string;
  order: TicketOrder;
  method: PaymentMethod;
  result: HandlerResult;
  correlationId: string;
  now: Date;
}

const MAX_REFERENCE_ATTEMPTS = 3;

@Injectable()
export class PaymentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Lock-free pre-read of a bound key (ADR-0005). Unbound keys do not exist outside a transaction. */
  async findKey(
    key: string,
  ): Promise<{ requestHash: string; responseStatus: number | null; responseBody: unknown } | null> {
    const rows = await this.prisma.$queryRaw<
      Array<{ request_hash: string; response_status: number | null; response_body: unknown }>
    >`SELECT request_hash, response_status, response_body
      FROM payments.idempotency_keys WHERE key = ${key}`;
    const row = rows[0];
    if (!row) return null;
    return {
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  /**
   * Claims the key, inserts the payment, runs the success bookkeeping for a
   * card, and binds the response to the key, all in one transaction. A
   * violation of `payments_one_live_per_order` rejects; the caller maps it.
   */
  async createWithKey(args: CreateWithKeyArgs): Promise<CreateWithKeyResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<Array<{ key: string }>>`
          INSERT INTO payments.idempotency_keys (key, request_hash)
          VALUES (${args.key}, ${args.requestHash})
          ON CONFLICT (key) DO NOTHING
          RETURNING key`;
        if (claimed.length === 0) {
          const stored = await tx.$queryRaw<
            Array<{ request_hash: string; response_body: unknown }>
          >`SELECT request_hash, response_body FROM payments.idempotency_keys WHERE key = ${args.key}`;
          const row = stored[0];
          if (row && row.request_hash === args.requestHash) {
            return { kind: 'REPLAY', body: row.response_body } as const;
          }
          return { kind: 'KEY_REUSE' } as const;
        }

        const { paymentId, order, method, result } = args;
        if (result.kind === 'SUCCEEDED') {
          await tx.$executeRaw`
            INSERT INTO payments.payments
              (id, order_id, method, status, amount_minor, currency, card_last4, succeeded_at)
            VALUES (${paymentId}::uuid, ${order.id}::uuid, ${method}, 'SUCCEEDED',
                    ${order.totalMinor}::bigint, ${order.currency}, ${result.details.cardLast4}, now())`;
          await this.recordSuccess(tx, paymentId, args.correlationId, args.now);
        } else {
          await tx.$executeRaw`
            INSERT INTO payments.payments
              (id, order_id, method, status, amount_minor, currency, qr_payload, succeed_after)
            VALUES (${paymentId}::uuid, ${order.id}::uuid, ${method}, 'PENDING',
                    ${order.totalMinor}::bigint, ${order.currency}, ${result.details.qrPayload},
                    now() + make_interval(secs => ${result.succeedAfterSeconds}::double precision))`;
        }

        const view = await this.viewIn(tx, paymentId);
        if (!view) throw new Error('payment vanished inside its own transaction');
        const body = JSON.stringify(view);
        await tx.$executeRaw`
          UPDATE payments.idempotency_keys
          SET payment_id = ${paymentId}::uuid, response_status = 201, response_body = ${body}::jsonb
          WHERE key = ${args.key}`;
        return { kind: 'CREATED', view } as const;
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  async findView(paymentId: string): Promise<PaymentView | null> {
    return this.viewIn(this.prisma, paymentId);
  }

  /** The status of the order's live payment, or null when there is none. */
  async liveStatusFor(orderId: string): Promise<'PENDING' | 'SUCCEEDED' | null> {
    const rows = await this.prisma.$queryRaw<Array<{ status: 'PENDING' | 'SUCCEEDED' }>>`
      SELECT status FROM payments.payments
      WHERE order_id = ${orderId}::uuid AND status IN ('PENDING', 'SUCCEEDED')`;
    return rows[0]?.status ?? null;
  }

  /**
   * Spec §4.3 steps 2 and 3, for a payment already moved to SUCCEEDED by the
   * caller: the transaction row and the `payment.succeeded` outbox event.
   * Runs inside the caller's DB transaction.
   */
  async recordSuccess(
    tx: Tx,
    paymentId: string,
    correlationId: string | null,
    now: Date,
  ): Promise<void> {
    const payments = await tx.$queryRaw<
      Array<{ order_id: string; amount_minor: bigint; currency: string }>
    >`SELECT order_id, amount_minor, currency FROM payments.payments WHERE id = ${paymentId}::uuid`;
    const payment = payments[0];
    if (!payment) throw new Error(`payment ${paymentId} not found`);

    let inserted: Array<{ id: string; payment_reference: string; created_at: Date }> = [];
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS && inserted.length === 0; attempt++) {
      const reference = newPaymentReference(now);
      inserted = await tx.$queryRaw<typeof inserted>`
        INSERT INTO payments.transactions (id, payment_id, payment_reference)
        VALUES (gen_random_uuid(), ${paymentId}::uuid, ${reference})
        ON CONFLICT (payment_reference) DO NOTHING
        RETURNING id, payment_reference, created_at`;
    }
    const transaction = inserted[0];
    if (!transaction) {
      throw new Error('could not generate a unique payment reference');
    }

    const event = {
      transactionId: transaction.id,
      paymentId,
      orderId: payment.order_id,
      paymentReference: transaction.payment_reference,
      amountMinor: toMinor(payment.amount_minor),
      currency: payment.currency,
      occurredAt: transaction.created_at.toISOString(),
      ...(correlationId ? { correlationId } : {}),
    };
    const payload = JSON.stringify(event);
    await tx.$executeRaw`
      INSERT INTO payments.outbox_events (type, payload)
      VALUES ('payment.succeeded', ${payload}::jsonb)`;
  }

  private async viewIn(db: Tx | PrismaService, paymentId: string): Promise<PaymentView | null> {
    const rows = await db.$queryRaw<PaymentRow[]>`
      SELECT p.id, p.order_id, p.method, p.status, p.amount_minor, p.currency, p.card_last4,
             p.qr_payload, p.created_at, p.succeeded_at, p.cancelled_at,
             t.id AS transaction_id, t.payment_reference, t.created_at AS transaction_created_at
      FROM payments.payments p
      LEFT JOIN payments.transactions t ON t.payment_id = p.id
      WHERE p.id = ${paymentId}::uuid`;
    const row = rows[0];
    return row ? toView(row) : null;
  }
}
