export type TicketTypeCode = 'GOLD' | 'PREMIUM' | 'VIP';
export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED';

export interface OrderLineRequest {
  ticketTypeCode: TicketTypeCode;
  quantity: number;
}

export interface PricedLine {
  ticketTypeCode: TicketTypeCode;
  ticketTypeId: string;
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

export function priceOrder(lines: PricedLine[]): { lines: PricedLine[]; totalMinor: number } {
  let totalMinor = 0;
  for (const line of lines) {
    if (line.lineTotalMinor !== line.unitPriceMinor * line.quantity) {
      throw new Error(`Line total mismatch for ${line.ticketTypeCode}`);
    }
    totalMinor += line.lineTotalMinor;
  }
  if (!Number.isSafeInteger(totalMinor)) {
    throw new RangeError('Order total is not a safe integer');
  }
  return { lines, totalMinor };
}
