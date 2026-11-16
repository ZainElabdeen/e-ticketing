import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { BackofficePage } from './BackofficePage';
import { RequireAuth } from './RequireAuth';
import { LoginPage } from './LoginPage';
import { clearSession, saveSession } from './session';
import { SummaryTiles } from './SummaryTiles';

const summary = (revenueMinor: number, transactionCount: number, available = 254): StubRoute => ({
  method: 'GET',
  path: '/v1/backoffice/summary',
  status: 200,
  body: {
    revenue: { amountMinor: revenueMinor, currency: 'AED' },
    transactionCount,
    tickets: { available, quota: 300 },
  },
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
  it('shows revenue, the transaction total and tickets left from one summary call', async () => {
    const fetch = stubFetch([summary(70000, 18)]);
    renderWithApp(<SummaryTiles />, { fetch });
    expect(await within(tile('Revenue')).findByText('AED 700.00')).toBeInTheDocument();
    expect(within(tile('Transactions')).getByText('18')).toBeInTheDocument();
    expect(within(tile('Tickets left')).getByText('254 / 300')).toBeInTheDocument();
    expect(fetch.calls).toHaveLength(1);
    expect(new URL(fetch.calls[0]!.url).pathname).toMatch(/\/v1\/backoffice\/summary$/);
  });

  it('shows zero revenue as a formatted amount', async () => {
    renderWithApp(<SummaryTiles />, { fetch: stubFetch([summary(0, 0, 300)]) });
    expect(await within(tile('Revenue')).findByText('AED 0.00')).toBeInTheDocument();
  });

  it('shows the same error in every tile when the summary fails', async () => {
    const fetch = stubFetch([
      {
        method: 'GET',
        path: '/v1/backoffice/summary',
        status: 429,
        body: { code: 'RATE_LIMITED', message: 'x' },
      },
    ]);
    renderWithApp(<SummaryTiles />, { fetch });
    await vi.waitFor(() => expect(tile('Revenue')).not.toHaveTextContent('…'));
    const message = within(tile('Revenue')).getByText(/./, { selector: 'p:last-child' });
    expect(within(tile('Transactions')).getByText(message.textContent ?? '')).toBeInTheDocument();
    expect(within(tile('Tickets left')).getByText(message.textContent ?? '')).toBeInTheDocument();
  });

  it('logs out once when the summary and the open section both return 401', async () => {
    saveSession('jwt', 3600);
    const fetch = stubFetch([
      unauthorized('/v1/backoffice/summary'),
      unauthorized('/v1/backoffice/transactions'),
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
