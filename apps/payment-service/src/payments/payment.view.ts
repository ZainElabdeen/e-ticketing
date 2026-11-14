import { toMinor } from '@eticket/nest-common';
import type { PaymentMethod, PaymentStatus } from './domain/types';

/** The API shape of a payment (contract schema `Payment`). */
export interface PaymentView {
  id: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  cardLast4: string | null;
  qrPayload: string | null;
  transaction?: { transactionId: string; paymentReference: string; createdAt: string };
  createdAt: string;
  succeededAt: string | null;
  cancelledAt: string | null;
}

/** One payments row left-joined to its transaction, as the raw queries return it. */
export interface PaymentRow {
  id: string;
  order_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount_minor: bigint;
  currency: string;
  card_last4: string | null;
  qr_payload: string | null;
  created_at: Date;
  succeeded_at: Date | null;
  cancelled_at: Date | null;
  transaction_id: string | null;
  payment_reference: string | null;
  transaction_created_at: Date | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toView(row: PaymentRow): PaymentView {
  const view: PaymentView = {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    status: row.status,
    amountMinor: toMinor(row.amount_minor),
    currency: row.currency,
    cardLast4: row.card_last4,
    qrPayload: row.qr_payload,
    createdAt: row.created_at.toISOString(),
    succeededAt: iso(row.succeeded_at),
    cancelledAt: iso(row.cancelled_at),
  };
  if (row.transaction_id && row.payment_reference && row.transaction_created_at) {
    view.transaction = {
      transactionId: row.transaction_id,
      paymentReference: row.payment_reference,
      createdAt: row.transaction_created_at.toISOString(),
    };
  }
  return view;
}
