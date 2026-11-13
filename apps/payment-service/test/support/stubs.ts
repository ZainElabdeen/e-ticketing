import { randomUUID } from 'node:crypto';
import type { HttpStub } from '@eticket/testing';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Registers GET /v1/orders/<id> on the ticket stub with a body valid against
 * the ticket contract's Order schema. Defaults: PENDING, 70000 AED (one GOLD
 * line, 700 AED), expires in 15 minutes.
 */
export function stubPayableOrder(
  ticket: HttpStub,
  order: Partial<{
    id: string;
    totalMinor: number;
    currency: string;
    status: string;
    expiresAt: string;
  }> = {},
): { id: string; totalMinor: number; currency: string } {
  const id = order.id ?? randomUUID();
  const totalMinor = order.totalMinor ?? 70000;
  const currency = order.currency ?? 'AED';
  const now = Date.now();
  const body = {
    id,
    status: order.status ?? 'PENDING',
    items: [
      {
        ticketTypeCode: 'GOLD',
        quantity: 1,
        unitPriceMinor: totalMinor,
        lineTotalMinor: totalMinor,
      },
    ],
    totalMinor,
    currency,
    createdAt: new Date(now).toISOString(),
    expiresAt: order.expiresAt ?? new Date(now + 15 * 60_000).toISOString(),
    confirmedAt: null,
    paidTransactionId: null,
  };
  ticket.on('GET', new RegExp(`^/v1/orders/${escapeRegExp(id)}$`), { status: 200, body });
  return { id, totalMinor, currency };
}
