import { useQueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { BackofficePage } from './BackofficePage';
import { RequireAuth } from './RequireAuth';
import { summaryKey } from './queries';
import { clearSession, saveSession } from './session';

const queries = vi.hoisted(() => ({ summaryRenders: 0 }));
vi.mock('./queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries')>();
  return {
    ...actual,
    // SummaryTiles calls this hook once per render, so the count is its render count.
    useSummary: (...args: Parameters<typeof actual.useSummary>) => {
      queries.summaryRenders += 1;
      return actual.useSummary(...args);
    },
  };
});

const ROUTES: StubRoute[] = [
  {
    method: 'GET',
    path: '/v1/backoffice/transactions',
    status: 200,
    body: { page: 1, pageSize: 20, total: 0, data: [] },
  },
  {
    method: 'GET',
    path: '/v1/backoffice/ledger-entries',
    status: 200,
    body: { page: 1, pageSize: 20, total: 0, data: [] },
  },
  {
    method: 'GET',
    path: '/v1/backoffice/accounts',
    status: 200,
    body: { data: [], totals: { debitMinor: 0, creditMinor: 0 } },
  },
  {
    method: 'GET',
    path: '/v1/backoffice/ticket-availability',
    status: 200,
    body: { data: [] },
  },
  {
    method: 'GET',
    path: '/v1/backoffice/summary',
    status: 200,
    body: {
      revenue: { amountMinor: 0, currency: 'AED' },
      transactionCount: 0,
      tickets: { available: 0, quota: 0 },
    },
  },
];

function TileRefetch(): React.ReactElement {
  const client = useQueryClient();
  return (
    <button type="button" onClick={() => void client.refetchQueries({ queryKey: summaryKey })}>
      tile refetch
    </button>
  );
}

function renderBackoffice(route: string, fetch = stubFetch(ROUTES)) {
  saveSession('jwt', 3600);
  const view = renderWithApp(
    <>
      <TileRefetch />
      <Routes>
        <Route
          path="/backoffice"
          element={
            <RequireAuth>
              <BackofficePage />
            </RequireAuth>
          }
        />
      </Routes>
    </>,
    { fetch, route },
  );
  return { ...view, fetch };
}

const count = (fetch: { calls: Request[] }, path: string): number =>
  fetch.calls.filter((r) => new URL(r.url).pathname.endsWith(path)).length;

/** Moves Date (which TanStack staleness reads) forward without firing any timers. */
function ageBy(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

afterEach(() => {
  clearSession();
  vi.useRealTimers();
  queries.summaryRenders = 0;
});

describe('backoffice freshness', () => {
  it('refetches an older-than-10s section once and shows Updating over the old data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ledgerCalls = 0;
    const inner = stubFetch(ROUTES);
    const fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('/ledger-entries') && ++ledgerCalls >= 2) await gate;
        return inner(input, init);
      },
      { calls: inner.calls },
    );
    const { user } = renderBackoffice('/backoffice?tab=ledger', fetch);
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Account balances' }));
    await screen.findByText('Balanced');
    ageBy(11_000);
    await user.click(screen.getByRole('tab', { name: 'Ledger entries' }));
    expect(await screen.findByText('Updating…')).toBeInTheDocument();
    expect(screen.getByText('No ledger entries yet.')).toBeInTheDocument();
    release();
    await vi.waitFor(() => expect(screen.queryByText('Updating…')).not.toBeInTheDocument());
    expect(count(fetch, '/ledger-entries')).toBe(2);
  });

  it('opens a section fetched under 10s ago without a request or a note', async () => {
    const { user, fetch } = renderBackoffice('/backoffice?tab=ledger');
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Account balances' }));
    await screen.findByText('Balanced');
    const before = fetch.calls.length;
    await user.click(screen.getByRole('tab', { name: 'Ledger entries' }));
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    expect(count(fetch, '/ledger-entries')).toBe(1);
    expect(fetch.calls.length).toBe(before);
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('a section switch makes no summary request', async () => {
    const { user, fetch } = renderBackoffice('/backoffice?tab=ledger');
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    await vi.waitFor(() => expect(count(fetch, '/summary')).toBe(1));
    const settled = count(fetch, '/summary');
    await user.click(screen.getByRole('tab', { name: 'Transactions' }));
    await user.click(screen.getByRole('tab', { name: 'Ledger entries' }));
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    expect(count(fetch, '/summary')).toBe(settled);
  });

  it('a tile refetch does not show Updating', async () => {
    const { user, fetch } = renderBackoffice('/backoffice?tab=ledger');
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'tile refetch' }));
    await vi.waitFor(() => expect(count(fetch, '/summary')).toBe(2));
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });

  it('does not re-render the summary tiles on a tab change', async () => {
    const { user } = renderBackoffice('/backoffice?tab=ledger');
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
    // Every tile has left its loading state before the baseline is taken.
    await vi.waitFor(() => {
      for (const name of ['Revenue', 'Transactions', 'Tickets left']) {
        expect(screen.getByRole('region', { name })).not.toHaveTextContent('…');
      }
    });
    const before = queries.summaryRenders;
    await user.click(screen.getByRole('tab', { name: 'Account balances' }));
    await screen.findByText('Balanced');
    expect(queries.summaryRenders).toBe(before);
  });
});
