import type { DownstreamClient, DownstreamResult } from '../downstream/downstream.client';
import { UpstreamTimeoutError, UpstreamUnavailableError } from '../downstream/errors';
import { BackofficeSummaryService, type BackofficeSummary } from './backoffice-summary.service';

const ok = (body: unknown): DownstreamResult => ({ status: 200, body, headers: {} });
const account = (code: string, balanceMinor: number, currency = 'AED') => ({
  code,
  name: 'n',
  type: 'REVENUE',
  currency,
  debitMinor: 0,
  creditMinor: balanceMinor,
  balanceMinor,
});
const type = (available: number, quota: number) => ({ available, quota });

function build(routes: Record<string, () => Promise<DownstreamResult>>) {
  const send = jest.fn((service: string, _method: string, path: string) => {
    const handler = routes[`${service} ${path}`];
    if (!handler) {
      throw new Error(`unexpected call ${service} ${path}`);
    }
    return handler();
  });
  const service = new BackofficeSummaryService({ send } as unknown as DownstreamClient);
  return { service, send };
}

const happy = {
  'ledger /v1/accounts': () =>
    Promise.resolve(ok({ data: [account('1100', 5), account('4000', 70000)] })),
  'payment /v1/transactions': () =>
    Promise.resolve(ok({ page: 1, pageSize: 1, total: 18, data: [] })),
  'ticket /v1/ticket-types': () =>
    Promise.resolve(ok({ data: [type(72, 100), type(95, 100), type(87, 100)] })),
};

describe('BackofficeSummaryService', () => {
  it('computes revenue, transaction count and tickets from the three services', async () => {
    const { service, send } = build(happy);
    await expect(service.summary('corr-1')).resolves.toEqual<BackofficeSummary>({
      revenue: { amountMinor: 70000, currency: 'AED' },
      transactionCount: 18,
      tickets: { available: 254, quota: 300 },
    });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith('payment', 'GET', '/v1/transactions', {
      correlationId: 'corr-1',
      query: { page: '1', pageSize: '1' },
    });
    expect(send).toHaveBeenCalledWith('ledger', 'GET', '/v1/accounts', { correlationId: 'corr-1' });
  });

  it('reports zero revenue in the first account currency when 4000 is missing', async () => {
    const { service } = build({
      ...happy,
      'ledger /v1/accounts': () => Promise.resolve(ok({ data: [account('1100', 5, 'USD')] })),
    });
    const summary = await service.summary('c');
    expect(summary.revenue).toEqual({ amountMinor: 0, currency: 'USD' });
  });

  it('falls back to AED when there are no accounts', async () => {
    const { service } = build({
      ...happy,
      'ledger /v1/accounts': () => Promise.resolve(ok({ data: [] })),
    });
    expect((await service.summary('c')).revenue).toEqual({ amountMinor: 0, currency: 'AED' });
  });

  it('fails with UPSTREAM_UNAVAILABLE when a downstream answers non-2xx', async () => {
    const { service } = build({
      ...happy,
      'payment /v1/transactions': () =>
        Promise.resolve({ status: 500, body: { code: 'X' }, headers: {} }),
    });
    await expect(service.summary('c')).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('fails with UPSTREAM_UNAVAILABLE when a body has an unexpected shape', async () => {
    const { service } = build({
      ...happy,
      'ticket /v1/ticket-types': () => Promise.resolve(ok({ nope: true })),
    });
    await expect(service.summary('c')).rejects.toBeInstanceOf(UpstreamUnavailableError);
  });

  it('propagates a downstream timeout as UpstreamTimeoutError', async () => {
    const { service } = build({
      ...happy,
      'ledger /v1/accounts': () =>
        Promise.reject(new UpstreamTimeoutError('ledger-service timed out')),
    });
    await expect(service.summary('c')).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });
});
