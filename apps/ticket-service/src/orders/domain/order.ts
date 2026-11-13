export type TicketTypeCode = 'GOLD' | 'PREMIUM' | 'VIP';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED';

export interface OrderLineRequest {
  ticketTypeCode: TicketTypeCode;
  quantity: number;
}

export interface PricedLine {
  ticketTypeCode: TicketTypeCode;
  ticketTypeId: string;
  currency: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
}

/** Ascending by code. Every writer locks ticket types in this order, so two orders cannot deadlock. */
export function sortLines<T extends { ticketTypeCode: TicketTypeCode }>(lines: T[]): T[] {
  return [...lines].sort((a, b) =>
    a.ticketTypeCode < b.ticketTypeCode ? -1 : a.ticketTypeCode > b.ticketTypeCode ? 1 : 0,
  );
}

export function priceOrder(lines: PricedLine[]): {
  lines: PricedLine[];
  totalMinor: number;
  currency: string;
} {
  const currency = lines[0]?.currency;
  if (!currency) {
    throw new Error('Order has no lines');
  }
  let totalMinor = 0;
  for (const line of lines) {
    if (line.currency !== currency) {
      throw new Error('Order lines mix currencies');
    }
    if (line.lineTotalMinor !== line.unitPriceMinor * line.quantity) {
      throw new Error(`Line total mismatch for ${line.ticketTypeCode}`);
    }
    totalMinor += line.lineTotalMinor;
  }
  if (!Number.isSafeInteger(totalMinor)) {
    throw new RangeError('Order total is not a safe integer');
  }
  return { lines, totalMinor, currency };
}

export type ConfirmationDecision = 'REPLAY' | 'CONFIRM_PENDING' | 'CONFIRM_EXPIRED' | 'REJECT';

/**
 * What to do with a payment confirmation. A paid order is honored even after it
 * expired (the customer's money is already taken); the repository then re-checks
 * quota because the expiry job released the reservation.
 */
export function decideConfirmation(
  order: { status: OrderStatus; paidTransactionId: string | null },
  transactionId: string,
): ConfirmationDecision {
  switch (order.status) {
    case 'PENDING':
      return 'CONFIRM_PENDING';
    case 'EXPIRED':
      return 'CONFIRM_EXPIRED';
    case 'CONFIRMED':
      return order.paidTransactionId === transactionId ? 'REPLAY' : 'REJECT';
  }
}
