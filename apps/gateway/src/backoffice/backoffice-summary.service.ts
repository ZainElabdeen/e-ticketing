import { Injectable } from '@nestjs/common';
import { DownstreamClient, type DownstreamResult } from '../downstream/downstream.client';
import { UpstreamUnavailableError } from '../downstream/errors';

/** Mirrors `BackofficeSummary` in packages/contracts/openapi/gateway.yaml. */
export interface BackofficeSummary {
  revenue: { amountMinor: number; currency: string };
  transactionCount: number;
  tickets: { available: number; quota: number };
}

const REVENUE_ACCOUNT_CODE = '4000';
const DEFAULT_CURRENCY = 'AED';

interface AccountRow {
  code: string;
  currency: string;
  balanceMinor: number;
}
interface TicketRow {
  available: number;
  quota: number;
}

/**
 * Reads a 2xx JSON body from a downstream result. The gateway is all-or-nothing here: any
 * non-2xx, or a body that is not the documented shape, fails the whole summary as a 502.
 */
function bodyOf(result: DownstreamResult, service: string): Record<string, unknown> {
  const body: unknown = result.body;
  if (result.status < 200 || result.status >= 300 || typeof body !== 'object' || body === null) {
    throw new UpstreamUnavailableError(`${service} answered with an unexpected response`);
  }
  return body as Record<string, unknown>;
}

function rowsOf<T>(body: Record<string, unknown>, service: string): T[] {
  if (!Array.isArray(body['data'])) {
    throw new UpstreamUnavailableError(`${service} answered with an unexpected response`);
  }
  return body['data'] as T[];
}

/** BFF aggregation for the backoffice tiles: three reads in parallel, one small read model. */
@Injectable()
export class BackofficeSummaryService {
  constructor(private readonly downstream: DownstreamClient) {}

  async summary(correlationId: string): Promise<BackofficeSummary> {
    const [ledger, payment, ticket] = await Promise.all([
      this.downstream.send('ledger', 'GET', '/v1/accounts', { correlationId }),
      this.downstream.send('payment', 'GET', '/v1/transactions', {
        correlationId,
        query: { page: '1', pageSize: '1' },
      }),
      this.downstream.send('ticket', 'GET', '/v1/ticket-types', { correlationId }),
    ]);

    const accounts = rowsOf<AccountRow>(bodyOf(ledger, 'ledger-service'), 'ledger-service');
    const total = bodyOf(payment, 'payment-service')['total'];
    if (typeof total !== 'number') {
      throw new UpstreamUnavailableError('payment-service answered with an unexpected response');
    }
    const types = rowsOf<TicketRow>(bodyOf(ticket, 'ticket-service'), 'ticket-service');

    const revenue = accounts.find((a) => a.code === REVENUE_ACCOUNT_CODE);
    return {
      revenue: {
        amountMinor: revenue?.balanceMinor ?? 0,
        currency: revenue?.currency ?? accounts[0]?.currency ?? DEFAULT_CURRENCY,
      },
      transactionCount: total,
      tickets: {
        available: types.reduce((n, t) => n + t.available, 0),
        quota: types.reduce((n, t) => n + t.quota, 0),
      },
    };
  }
}
