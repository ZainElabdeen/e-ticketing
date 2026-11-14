import { act, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { BackofficePage } from './BackofficePage';
import { LoginPage } from './LoginPage';
import { RequireAuth } from './RequireAuth';
import { clearSession, saveSession } from './session';

function Where(): React.ReactElement {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderBackoffice(routes: StubRoute[], route = '/backoffice') {
  const fetch = stubFetch(routes);
  const view = renderWithApp(
    <>
      <Where />
      <Routes>
        <Route path="/backoffice/login" element={<LoginPage />} />
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

const tx = (n: number) => ({
  transactionId: `${String(n).padStart(8, '0')}-aaaa-bbbb-cccc-ddddeeeeffff`,
  paymentReference: `PAY-20261114-ABC${n}`,
  createdAt: '2026-11-14T13:05:00.000Z',
  paymentId: 'p-1',
  orderId: `${String(n + 100).padStart(8, '0')}-1111-2222-3333-444455556666`,
  amountMinor: 20000,
  currency: 'AED',
  method: 'CARD',
});
const txPage = (total: number, page = 1): StubRoute => ({
  method: 'GET',
  path: '/v1/backoffice/transactions',
  status: 200,
  body: { page, pageSize: 20, total, data: [tx(1), tx(2)] },
});
const accounts = (debit: number, credit: number): StubRoute => ({
  method: 'GET',
  path: '/v1/backoffice/accounts',
  status: 200,
  body: {
    data: [
      {
        code: '1100',
        name: 'Payment Gateway Clearing',
        type: 'ASSET',
        currency: 'AED',
        debitMinor: debit,
        creditMinor: 0,
        balanceMinor: debit,
      },
      {
        code: '4000',
        name: 'Ticket Sales Revenue',
        type: 'REVENUE',
        currency: 'AED',
        debitMinor: 0,
        creditMinor: credit,
        balanceMinor: credit,
      },
    ],
    totals: { debitMinor: debit, creditMinor: credit },
  },
});

afterEach(() => {
  clearSession();
  vi.useRealTimers();
});

describe('BackofficePage', () => {
  it('redirects to login without a session', async () => {
    renderBackoffice([]);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/backoffice/login');
  });

  it('sends the bearer token on backoffice calls', async () => {
    saveSession('jwt-9', 3600);
    const { fetch } = renderBackoffice([txPage(2)]);
    expect(await screen.findByText('PAY-20261114-ABC1')).toBeInTheDocument();
    expect(fetch.calls[0]!.headers.get('Authorization')).toBe('Bearer jwt-9');
  });

  it('transactions tab lists rows and paginates', async () => {
    saveSession('jwt', 3600);
    const { user, fetch } = renderBackoffice([txPage(45)]);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prev' })).toBeDisabled();
    const short = screen.getByText('00000001');
    expect(short).toHaveAttribute('title', '00000001-aaaa-bbbb-cccc-ddddeeeeffff');
    expect(screen.getAllByText('AED 200.00')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(fetch.calls.some((c) => new URL(c.url).searchParams.get('page') === '2')).toBe(true),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('tab=transactions&page=2');
  });

  it('shows the empty state when there are no transactions', async () => {
    saveSession('jwt', 3600);
    renderBackoffice([
      {
        method: 'GET',
        path: '/v1/backoffice/transactions',
        status: 200,
        body: { page: 1, pageSize: 20, total: 0, data: [] },
      },
    ]);
    expect(
      await screen.findByText('No transactions yet. Buy a ticket in the shop to see one here.'),
    ).toBeInTheDocument();
  });

  it('clamps a page past the last page', async () => {
    saveSession('jwt', 3600);
    renderBackoffice(
      [
        {
          method: 'GET',
          path: '/v1/backoffice/transactions',
          status: 200,
          body: { page: 9, pageSize: 20, total: 45, data: [] },
        },
      ],
      '/backoffice?tab=transactions&page=9',
    );
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('tab=transactions&page=3'),
    );
  });

  it('accounts tab shows balanced totals', async () => {
    saveSession('jwt', 3600);
    renderBackoffice([accounts(40000, 40000)], '/backoffice?tab=accounts');
    expect(await screen.findByText('Balanced')).toBeInTheDocument();
    expect(screen.getByText('Payment Gateway Clearing')).toBeInTheDocument();
  });

  it('accounts tab flags imbalance', async () => {
    saveSession('jwt', 3600);
    renderBackoffice([accounts(40000, 39900)], '/backoffice?tab=accounts');
    expect(await screen.findByText('Out of balance')).toBeInTheDocument();
  });

  it('ledger tab shows lines with debit and credit', async () => {
    saveSession('jwt', 3600);
    renderBackoffice(
      [
        {
          method: 'GET',
          path: '/v1/backoffice/ledger-entries',
          status: 200,
          body: {
            page: 1,
            pageSize: 20,
            total: 1,
            data: [
              {
                id: 'e-1',
                transactionId: 't-1',
                postingType: 'TICKET_SALE',
                orderId: 'o-1',
                paymentReference: 'PAY-20261114-ABC1',
                currency: 'AED',
                postedAt: '2026-11-14T13:05:00.000Z',
                lines: [
                  {
                    id: 'l1',
                    accountCode: '1100',
                    accountName: 'Payment Gateway Clearing',
                    direction: 'DEBIT',
                    amountMinor: 70000,
                  },
                  {
                    id: 'l2',
                    accountCode: '4000',
                    accountName: 'Ticket Sales Revenue',
                    direction: 'CREDIT',
                    amountMinor: 70000,
                  },
                ],
              },
            ],
          },
        },
      ],
      '/backoffice?tab=ledger',
    );
    expect(await screen.findByText('PAY-20261114-ABC1')).toBeInTheDocument();
    expect(screen.getByText('Ticket sale')).toBeInTheDocument();
    const debitRow = screen.getByText('1100 Payment Gateway Clearing').closest('tr')!;
    expect(within(debitRow).getAllByRole('cell')[1]).toHaveTextContent('AED 700.00');
    expect(within(debitRow).getAllByRole('cell')[2]).toHaveTextContent('');
    const creditRow = screen.getByText('4000 Ticket Sales Revenue').closest('tr')!;
    expect(within(creditRow).getAllByRole('cell')[2]).toHaveTextContent('AED 700.00');
    const totals = screen.getByText('Totals').closest('tr')!;
    expect(within(totals).getAllByRole('cell')[1]).toHaveTextContent('AED 700.00');
    expect(within(totals).getAllByRole('cell')[2]).toHaveTextContent('AED 700.00');
  });

  it('shows the ledger empty state', async () => {
    saveSession('jwt', 3600);
    renderBackoffice(
      [
        {
          method: 'GET',
          path: '/v1/backoffice/ledger-entries',
          status: 200,
          body: { page: 1, pageSize: 20, total: 0, data: [] },
        },
      ],
      '/backoffice?tab=ledger',
    );
    expect(await screen.findByText('No ledger entries yet.')).toBeInTheDocument();
  });

  it('availability tab lists quota, sold, reserved, available', async () => {
    saveSession('jwt', 3600);
    renderBackoffice(
      [
        {
          method: 'GET',
          path: '/v1/backoffice/ticket-availability',
          status: 200,
          body: {
            data: [
              {
                code: 'GOLD',
                name: 'Gold',
                priceMinor: 10000,
                currency: 'AED',
                quota: 100,
                sold: 12,
                reserved: 3,
                available: 85,
              },
            ],
          },
        },
      ],
      '/backoffice?tab=availability',
    );
    const row = (await screen.findByText('Gold')).closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells.map((c) => c.textContent)).toEqual(['Gold', 'AED 100.00', '100', '12', '3', '85']);
  });

  it('a transient error shows a banner with Try again and keeps the session', async () => {
    saveSession('jwt', 3600);
    const { user } = renderBackoffice([
      {
        method: 'GET',
        path: '/v1/backoffice/transactions',
        status: 503,
        body: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' },
        responses: [
          { status: 503, body: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } },
          txPage(2).responses?.[0] ?? { status: 200, body: txPage(2).body },
        ],
      },
    ]);
    expect(
      await screen.findByText('Something went wrong on our side. Try again.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('PAY-20261114-ABC1')).toBeInTheDocument();
  });

  it('401 returns to login with a notice', async () => {
    saveSession('jwt', 3600);
    renderBackoffice([
      {
        method: 'GET',
        path: '/v1/backoffice/transactions',
        status: 401,
        body: { code: 'UNAUTHORIZED', message: 'x' },
      },
    ]);
    expect(await screen.findByText('Your session ended. Sign in again.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/backoffice/login');
    expect(window.sessionStorage.getItem('eticket.backoffice.session')).toBeNull();
  });

  it('sign out clears the session', async () => {
    saveSession('jwt', 3600);
    const { user } = renderBackoffice([txPage(2)]);
    await screen.findByText('PAY-20261114-ABC1');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('eticket.backoffice.session')).toBeNull();
    expect(screen.queryByText('Your session ended. Sign in again.')).not.toBeInTheDocument();
  });

  it('logs out with a notice when the session expires', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    saveSession('jwt', 60);
    renderBackoffice([txPage(2)]);
    expect(screen.getByRole('heading', { name: 'Backoffice' })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByText('Your session ended. Sign in again.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/backoffice/login');
  });

  it('redirects with the notice when the session is already expired at render', () => {
    saveSession('jwt', 60, () => Date.now() - 120_000);
    renderBackoffice([txPage(2)]);
    expect(screen.getByTestId('where')).toHaveTextContent('/backoffice/login');
    expect(screen.getByText('Your session ended. Sign in again.')).toBeInTheDocument();
  });

  it('a 401 on a non-backoffice query does not log out', async () => {
    saveSession('jwt', 3600);
    function Probe(): React.ReactElement {
      const api = useApi();
      const q = useQuery({
        queryKey: ['payment', 'p-1'],
        queryFn: () => call(api.GET('/v1/ticket-types')),
        retry: false,
      });
      return <p>{q.isError ? 'probe failed' : 'probe loading'}</p>;
    }
    const fetch = stubFetch([
      {
        method: 'GET',
        path: '/v1/ticket-types',
        status: 401,
        body: { code: 'UNAUTHORIZED', message: 'x' },
      },
      txPage(2),
    ]);
    renderWithApp(
      <RequireAuth>
        <Probe />
      </RequireAuth>,
      { fetch },
    );
    expect(await screen.findByText('probe failed')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('eticket.backoffice.session')).not.toBeNull();
    expect(screen.queryByText('Your session ended. Sign in again.')).not.toBeInTheDocument();
  });

  it('flags a ledger entry whose debits and credits differ', async () => {
    saveSession('jwt', 3600);
    const line = (id: string, direction: string, amountMinor: number) => ({
      id,
      accountCode: '1100',
      accountName: 'Clearing',
      direction,
      amountMinor,
    });
    renderBackoffice(
      [
        {
          method: 'GET',
          path: '/v1/backoffice/ledger-entries',
          status: 200,
          body: {
            page: 1,
            pageSize: 20,
            total: 1,
            data: [
              {
                id: 'e-1',
                transactionId: 't-1',
                postingType: 'TICKET_SALE',
                orderId: 'o-1',
                paymentReference: 'PAY-X',
                currency: 'AED',
                postedAt: '2026-11-14T13:05:00.000Z',
                lines: [line('a', 'DEBIT', 70000), line('b', 'CREDIT', 60000)],
              },
            ],
          },
        },
      ],
      '/backoffice?tab=ledger',
    );
    const totals = (await screen.findByText('Totals')).closest('tr')!;
    expect(totals.className).toContain('bad');
    expect(screen.getByText('Posted')).toBeInTheDocument();
    expect(screen.getByText('Reference')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
  });
});
