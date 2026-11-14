import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import {
  decideConfirmation,
  priceOrder,
  sortLines,
  type OrderLineRequest,
  type OrderStatus,
  type PricedLine,
  type TicketTypeCode,
} from './domain/order';
import { OrderNotConfirmableError, OrderNotFoundError, QuotaExceededError } from './domain/errors';
import { isUniqueViolation, toMinor } from '@eticket/nest-common';
import { toOrderView, type OrderView } from './order.view';

const WITH_ITEMS = { items: { include: { ticketType: { select: { code: true } } } } } as const;

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserves quota for every line and creates the order in one transaction.
   * Ticket types are locked in ascending code order (the UPDATE takes the row
   * lock), so concurrent orders cannot deadlock. Any failed line rolls back all.
   */
  async reserveAndCreate(lines: OrderLineRequest[], ttlMinutes: number): Promise<OrderView> {
    const orderId = await this.prisma.$transaction(
      async (tx) => {
        const priced: PricedLine[] = [];
        for (const line of sortLines(lines)) {
          const rows = await tx.$queryRaw<
            Array<{ id: string; price_minor: bigint; currency: string }>
          >`
          UPDATE tickets.ticket_types SET reserved = reserved + ${line.quantity}::int
           WHERE code = ${line.ticketTypeCode} AND sold + reserved + ${line.quantity}::int <= quota
          RETURNING id, price_minor, currency`;
          const reserved = rows[0];
          if (!reserved) {
            throw new QuotaExceededError(line.ticketTypeCode);
          }
          const unit = toMinor(reserved.price_minor);
          priced.push({
            ticketTypeCode: line.ticketTypeCode,
            ticketTypeId: reserved.id,
            currency: reserved.currency,
            quantity: line.quantity,
            unitPriceMinor: unit,
            lineTotalMinor: unit * line.quantity,
          });
        }
        const { lines: final, totalMinor, currency } = priceOrder(priced);
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO tickets.orders (status, total_minor, currency, expires_at)
        VALUES ('PENDING', ${BigInt(totalMinor)}, ${currency}, now() + make_interval(mins => ${ttlMinutes}::int))
        RETURNING id`;
        const id = inserted[0]?.id;
        if (!id) {
          throw new Error('Order insert returned no id');
        }
        await tx.orderItem.createMany({
          data: final.map((l) => ({
            orderId: id,
            ticketTypeId: l.ticketTypeId,
            quantity: l.quantity,
            unitPriceMinor: BigInt(l.unitPriceMinor),
            lineTotalMinor: BigInt(l.lineTotalMinor),
          })),
        });
        return id;
      },
      { maxWait: 5000, timeout: 10000 },
    );
    const view = await this.findById(orderId);
    if (!view) {
      throw new Error(`Order ${orderId} vanished after creation`);
    }
    return view;
  }

  async findById(id: string): Promise<OrderView | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: WITH_ITEMS });
    return row ? toOrderView(row) : null;
  }

  /** Order items with their ticket type code, in ascending code order (the lock order). */
  private async loadSortedItems(tx: Prisma.TransactionClient, orderId: string) {
    const items = await tx.$queryRaw<
      Array<{ ticket_type_id: string; quantity: number; code: string }>
    >`
      SELECT i.ticket_type_id, i.quantity, t.code
        FROM tickets.order_items i
        JOIN tickets.ticket_types t ON t.id = i.ticket_type_id
       WHERE i.order_id = ${orderId}::uuid`;
    return sortLines(items.map((i) => ({ ...i, ticketTypeCode: i.code as TicketTypeCode })));
  }

  /**
   * Expires one due PENDING order and releases its reservation. SKIP LOCKED lets
   * concurrent runners (and a confirm holding the row) pass over each other.
   * Returns the expired order id, or null when nothing is due.
   */
  async expireOne(): Promise<string | null> {
    return this.prisma.$transaction(
      async (tx) => {
        const due = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM tickets.orders
           WHERE status = 'PENDING' AND expires_at < now()
           ORDER BY expires_at
           FOR UPDATE SKIP LOCKED LIMIT 1`;
        const id = due[0]?.id;
        if (!id) {
          return null;
        }
        const updated = await tx.$executeRaw`
          UPDATE tickets.orders SET status = 'EXPIRED' WHERE id = ${id}::uuid AND status = 'PENDING'`;
        if (updated === 0) {
          return null;
        }
        for (const item of await this.loadSortedItems(tx, id)) {
          await tx.$executeRaw`
            UPDATE tickets.ticket_types SET reserved = reserved - ${item.quantity}::int
             WHERE id = ${item.ticket_type_id}::uuid`;
        }
        return id;
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * Confirms a paid order. Lock order: the order row (blocking), then ticket
   * types in ascending code. `decideConfirmation` picks the branch; the SQL for
   * each branch runs here, inside the locked transaction.
   */
  async confirm(orderId: string, transactionId: string): Promise<OrderView> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          const orders = await tx.$queryRaw<
            Array<{ id: string; status: OrderStatus; paid_transaction_id: string | null }>
          >`SELECT id, status, paid_transaction_id FROM tickets.orders WHERE id = ${orderId}::uuid FOR UPDATE`;
          const order = orders[0];
          if (!order) {
            throw new OrderNotFoundError(orderId);
          }
          const decision = decideConfirmation(
            { status: order.status, paidTransactionId: order.paid_transaction_id },
            transactionId,
          );
          if (decision === 'REPLAY') {
            return;
          }
          if (decision === 'REJECT') {
            throw new OrderNotConfirmableError(
              `Order ${orderId} is already confirmed by another transaction`,
            );
          }
          // A unique violation would abort this transaction, so look first. The
          // catch below is the backstop for two orders racing on one transaction id.
          const used = await tx.$queryRaw<Array<{ one: number }>>`
            SELECT 1 AS one FROM tickets.orders
             WHERE paid_transaction_id = ${transactionId}::uuid AND id <> ${orderId}::uuid`;
          if (used.length > 0) {
            throw new OrderNotConfirmableError(
              `Transaction ${transactionId} already confirmed another order`,
            );
          }
          const sorted = await this.loadSortedItems(tx, orderId);
          for (const item of sorted) {
            if (decision === 'CONFIRM_PENDING') {
              await tx.$executeRaw`
                UPDATE tickets.ticket_types
                   SET reserved = reserved - ${item.quantity}::int, sold = sold + ${item.quantity}::int
                 WHERE id = ${item.ticket_type_id}::uuid`;
            } else {
              const rows = await tx.$queryRaw<Array<{ id: string }>>`
                UPDATE tickets.ticket_types SET sold = sold + ${item.quantity}::int
                 WHERE id = ${item.ticket_type_id}::uuid
                   AND sold + reserved + ${item.quantity}::int <= quota
                RETURNING id`;
              if (rows.length === 0) {
                throw new OrderNotConfirmableError(
                  `Order ${orderId} expired and ${item.code} is no longer available`,
                );
              }
            }
          }
          await tx.$executeRaw`
            UPDATE tickets.orders
               SET status = 'CONFIRMED', confirmed_at = now(), paid_transaction_id = ${transactionId}::uuid
             WHERE id = ${orderId}::uuid`;
        },
        { maxWait: 5000, timeout: 10000 },
      );
    } catch (err) {
      if (isUniqueViolation(err, 'orders_paid_transaction_id_key')) {
        throw new OrderNotConfirmableError(
          `Transaction ${transactionId} already confirmed another order`,
        );
      }
      throw err;
    }
    const view = await this.findById(orderId);
    if (!view) {
      throw new Error(`Order ${orderId} vanished after confirmation`);
    }
    return view;
  }
}
