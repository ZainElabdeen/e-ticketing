import { toMinor } from '../common/money';

export interface TicketTypeView {
  code: 'GOLD' | 'PREMIUM' | 'VIP';
  name: string;
  priceMinor: number;
  currency: string;
  quota: number;
  sold: number;
  reserved: number;
  available: number;
}

export interface TicketTypeRow {
  code: string;
  name: string;
  priceMinor: bigint;
  currency: string;
  quota: number;
  sold: number;
  reserved: number;
}

export function toTicketTypeView(row: TicketTypeRow): TicketTypeView {
  return {
    code: row.code as TicketTypeView['code'],
    name: row.name,
    priceMinor: toMinor(row.priceMinor),
    currency: row.currency,
    quota: row.quota,
    sold: row.sold,
    reserved: row.reserved,
    available: row.quota - row.sold - row.reserved,
  };
}
