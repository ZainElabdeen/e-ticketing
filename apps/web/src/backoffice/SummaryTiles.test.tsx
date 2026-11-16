import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { BackofficePage } from './BackofficePage';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from './LoginPage';
import { clearSession, saveSession } from './session';
import { SummaryTiles } from './SummaryTiles';

const accounts = (data: unknown[]): StubRoute => ({
  method: 'GET',
  path: '/v1/backoffice/accounts',
  status: 200,
  body: { data, totals: { debitMinor: 0, creditMinor: 0 } },
});
const account = (code: string, balanceMinor: number) => ({
  code,
  name: 'n',
  type: 'REVENUE',
  currency: 'AED',
  debitMinor: 0,
  creditMinor: balanceMinor,
  balanceMinor,
});
const row = (code: string, available: number) => ({
  code,
  name: code,
  priceMinor: 10000,
  currency: 'AED',
  quota: 100,
  sold: 100 - available,
  reserved: 0,
  available,
});
const unauthorized = (path: string): StubRoute => ({
  method: 'GET',
  path,
  status: 401,
  body: { code: 'UNAUTHORIZED', message: 'x' },
});

const tile = (name: string) => screen.getByRole('region', { name });

afterEach(() => clearSession());

describe('SummaryTiles', () => {
  it('shows revenue from account 4000', async () => {
    const fetch = stubFetch([accounts([account('1100', 5), account('4000', 70000)])]);
    renderWithApp(<SummaryTiles />, { fetch });
    expect(await within(tile('Revenue')).findByText('AED 700.00')).toBeInTheDocument();
  });

  it('shows a dash when the revenue account is missing', async () => {
    const fetch = stubFetch([accounts([account('1100', 5)])]);
    renderWithApp(<SummaryTiles />, { fetch });
    expect(await within(tile('Revenue')).findByText('—')).toBeInTheDocument();
  });

  it('shows the transaction total', async () => {
    const fetch = stubFetch([
      {
        method: 'GET',
        path: '/v1/backoffice/transactions',
        status: 200,
        body: { page: 1, pageSize: 20, total: 18, data: [] },
      },
    ]);
    renderWithApp(<SummaryTiles />, { fetch });
    expect(await within(tile('Transactions')).findByText('18')).toBeInTheDocument();
  });

  it('sums tickets left', async () => {
    const fetch = stubFetch([
      {
        method: 'GET',
        path: '/v1/backoffice/ticket-availability',
        status: 200,
        body: { data: [row('GOLD', 72), row('PREMIUM', 95), row('VIP', 87)] },
      },
    ]);
    renderWithApp(<SummaryTiles />, { fetch });
    expect(await within(tile('Tickets left')).findByText('254 / 300')).toBeInTheDocument();
  });

  it('logs out once when every backoffice query returns 401', async () => {
    saveSession('jwt', 3600);
    const fetch = stubFetch([
      unauthorized('/v1/backoffice/accounts'),
      unauthorized('/v1/backoffice/transactions'),
      unauthorized('/v1/backoffice/ticket-availability'),
    ]);
    renderWithApp(
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
      </Routes>,
      { fetch, route: '/backoffice' },
    );
    expect(await screen.findAllByText('Your session ended. Sign in again.')).toHaveLength(1);
  });
});
