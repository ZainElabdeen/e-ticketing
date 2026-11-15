import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { ResultPage } from './ResultPage';

const ISO = '2026-11-14T13:05:00.000Z';
const base = {
  id: 'p-1',
  orderId: 'o-1',
  method: 'CARD',
  amountMinor: 70000,
  currency: 'AED',
  createdAt: ISO,
};
const succeeded = {
  ...base,
  status: 'SUCCEEDED',
  cardLast4: '4242',
  transaction: {
    transactionId: 'tx-9f1c',
    paymentReference: 'PAY-20261114-7F3K9Q',
    createdAt: ISO,
  },
};
const route = (status: number, body?: unknown): StubRoute => ({
  method: 'GET',
  path: '/v1/payments/p-1',
  status,
  body,
});

function renderResult(routes: StubRoute[]) {
  return renderWithApp(
    <Routes>
      <Route path="/result/:paymentId" element={<ResultPage />} />
    </Routes>,
    { fetch: stubFetch(routes), route: '/result/p-1' },
  );
}

describe('ResultPage', () => {
  it('shows transaction id, reference, timestamp and amount', async () => {
    const { container } = renderResult([route(200, succeeded)]);
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
    expect(screen.getByText('tx-9f1c')).toBeInTheDocument();
    expect(screen.getByText('PAY-20261114-7F3K9Q')).toBeInTheDocument();
    expect(screen.getByText(/AED\s700\.00/u)).toBeInTheDocument();
    expect(screen.getByText('o-1')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', ISO);
    expect(screen.getByRole('link', { name: 'Buy more tickets' })).toHaveAttribute('href', '/');
  });

  it('exposes the stamp to assistive tech without reading PAID twice', async () => {
    const { container } = renderResult([route(200, succeeded)]);
    await screen.findByText('Payment received');
    const stamp = container.querySelector('[aria-hidden="true"]');
    expect(stamp).toHaveTextContent('PAID');
    expect(screen.getByText('Paid in full')).toBeInTheDocument();
  });

  it('card shows last four', async () => {
    renderResult([route(200, succeeded)]);
    expect(await screen.findByText('Card ending 4242')).toBeInTheDocument();
  });

  it('qr shows qr scan', async () => {
    renderResult([route(200, { ...succeeded, method: 'QR', cardLast4: null })]);
    expect(await screen.findByText('QR scan')).toBeInTheDocument();
  });

  it('pending links to the QR page', async () => {
    renderResult([route(200, { ...base, method: 'QR', status: 'PENDING' })]);
    expect(await screen.findByText('This payment is still processing')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Show QR code' })).toHaveAttribute(
      'href',
      '/checkout/o-1/qr/p-1',
    );
  });

  it('cancelled offers start over', async () => {
    renderResult([route(200, { ...base, status: 'CANCELLED' })]);
    expect(await screen.findByText('This payment was cancelled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
  });

  it('unknown payment shows not found', async () => {
    renderResult([route(404, { code: 'PAYMENT_NOT_FOUND', message: 'x' })]);
    expect(await screen.findByText("We couldn't find this payment")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the rate limit text when the first load is rate limited', async () => {
    renderResult([
      route(429, { statusCode: 429, code: 'RATE_LIMITED', message: 'x', correlationId: 'c' }),
    ]);
    expect(await screen.findByText('Too many requests, try again shortly')).toBeInTheDocument();
  });

  it('a transient first-load error offers try again, never not found', async () => {
    const { user } = renderResult([
      {
        method: 'GET',
        path: '/v1/payments/p-1',
        status: 503,
        responses: [
          { status: 503, body: { code: 'X', message: 'x' } },
          { status: 200, body: succeeded },
        ],
      },
    ]);
    expect(
      await screen.findByText('Something went wrong on our side. Try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText("We couldn't find this payment")).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Payment received')).toBeInTheDocument();
  });
});
