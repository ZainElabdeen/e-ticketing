import { Injectable } from '@nestjs/common';
import { toMinor } from '@eticket/nest-common';
import { PrismaService } from '../common/prisma.service';
import type { PaymentMethod } from '../payments/domain/types';

export interface TransactionView {
  transactionId: string;
  paymentReference: string;
  createdAt: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
}

export interface TransactionPage {
  data: TransactionView[];
  page: number;
  pageSize: number;
  total: number;
}

interface TransactionRow {
  transaction_id: string;
  payment_reference: string;
  created_at: Date;
  payment_id: string;
  order_id: string;
  amount_minor: bigint;
  currency: string;
  method: PaymentMethod;
}

@Injectable()
export class TransactionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first; `id` breaks ties so pages never overlap or skip rows. */
  async list(page: number, pageSize: number): Promise<TransactionPage> {
    const offset = (page - 1) * pageSize;
    const [counts, rows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM payments.transactions`,
      this.prisma.$queryRaw<TransactionRow[]>`
        SELECT t.id AS transaction_id, t.payment_reference, t.created_at,
               p.id AS payment_id, p.order_id, p.amount_minor, p.currency, p.method
          FROM payments.transactions t
          JOIN payments.payments p ON p.id = t.payment_id
         ORDER BY t.created_at DESC, t.id DESC
         LIMIT ${pageSize} OFFSET ${offset}`,
    ]);
    return {
      data: rows.map((r) => ({
        transactionId: r.transaction_id,
        paymentReference: r.payment_reference,
        createdAt: r.created_at.toISOString(),
        paymentId: r.payment_id,
        orderId: r.order_id,
        amountMinor: toMinor(r.amount_minor),
        currency: r.currency,
        method: r.method,
      })),
      page,
      pageSize,
      total: toMinor(counts[0]?.n ?? 0n),
    };
  }
}
