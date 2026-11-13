import { toMinor } from '../common/money';
import type { OrderStatus, TicketTypeCode } from './domain/order';

export interface OrderView {
  id: string;
  status: OrderStatus;
  items: Array<{
    ticketTypeCode: TicketTypeCode;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  totalMinor: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  paidTransactionId: string | null;
}

export interface OrderRow {
  id: string;
  status: string;
  totalMinor: bigint;
  currency: string;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  paidTransactionId: string | null;
  items: Array<{
    quantity: number;
    unitPriceMinor: bigint;
    lineTotalMinor: bigint;
    ticketType: { code: string };
  }>;
}

export function toOrderView(row: OrderRow): OrderView {
  return {
    id: row.id,
    status: row.status as OrderStatus,
    items: row.items
      .map((i) => ({
        ticketTypeCode: i.ticketType.code as TicketTypeCode,
        quantity: i.quantity,
        unitPriceMinor: toMinor(i.unitPriceMinor),
        lineTotalMinor: toMinor(i.lineTotalMinor),
      }))
      .sort((a, b) =>
        a.ticketTypeCode < b.ticketTypeCode ? -1 : a.ticketTypeCode > b.ticketTypeCode ? 1 : 0,
      ),
    totalMinor: toMinor(row.totalMinor),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    paidTransactionId: row.paidTransactionId,
  };
}
