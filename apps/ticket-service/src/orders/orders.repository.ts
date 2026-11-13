import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { priceOrder, sortLines, type OrderLineRequest, type PricedLine } from './domain/order';
import { QuotaExceededError } from './domain/errors';
import { toMinor } from '../common/money';
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
    const orderId = await this.prisma.$transaction(async (tx) => {
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
          quantity: line.quantity,
          unitPriceMinor: unit,
          lineTotalMinor: unit * line.quantity,
        });
      }
      const { lines: final, totalMinor } = priceOrder(priced);
      const inserted = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO tickets.orders (status, total_minor, expires_at)
        VALUES ('PENDING', ${BigInt(totalMinor)}, now() + make_interval(mins => ${ttlMinutes}::int))
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
    });
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
}
