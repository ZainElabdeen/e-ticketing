import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetPayment, recallPayment, rememberPayment } from '../checkout/paymentMemory';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { QrPage } from './QrPage';

const pay = (status: string) => ({
  id: 'p-2',
  orderId: 'o-1',
  method: 'QR',
  status,
  amountMinor: 70000,
  currency: 'AED',
  qrPayload: 'eticket:pay:p-2',
});
const getRoute = (status: number, body: unknown): StubRoute => ({
  method: 'GET',
  path: '/v1/payments/p-2',
  status,
  body,
});
const cancelRoute = (status: number, body: unknown): StubRoute => ({
  method: 'POST',
  path: '/v1/payments/p-2/cancel',
  status,
  body,
});

function Where(): React.ReactElement {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderQr(routes: StubRoute[]) {
  const fetch = stubFetch(routes);
  const utils = renderWithApp(
    <Routes>
      <Route path="/checkout/:orderId/qr/:paymentId" element={<QrPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { fetch, route: '/checkout/o-1/qr/p-2' },
  );
  return { fetch, ...utils };
}

afterEach(() => {
  vi.useRealTimers();
  forgetPayment('o-1');
});

describe('QrPage', () => {
  it('QR page loads from the URL alone', async () => {
    const { container } = renderQr([getRoute(200, pay('PENDING'))]);
    expect(await screen.findByText('Scan to pay')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText(/AED\s700\.00/u)).toBeInTheDocument();
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument();
  });

  it('succeeded redirects to result', async () => {
    renderQr([getRoute(200, pay('SUCCEEDED'))]);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-2'));
  });

  it('use card instead cancels and returns to checkout with card selected', async () => {
    rememberPayment('o-1', { paymentId: 'p-2', method: 'QR' });
    const { fetch, user } = renderQr([
      getRoute(200, pay('PENDING')),
      cancelRoute(200, pay('CANCELLED')),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Use card instead' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/checkout/o-1?method=card'),
    );
    expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(recallPayment('o-1')).toBeNull();
  });

  it('cancel conflict on a succeeded payment goes to result', async () => {
    const { user } = renderQr([
      {
        method: 'GET',
        path: '/v1/payments/p-2',
        status: 200,
        responses: [
          { status: 200, body: pay('PENDING') },
          { status: 200, body: pay('SUCCEEDED') },
        ],
      },
      cancelRoute(409, { statusCode: 409, code: 'PAYMENT_NOT_CANCELLABLE', message: 'x' }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Use card instead' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-2'));
  });

  it('shows a cancelled payment with a way back', async () => {
    renderQr([getRoute(200, pay('CANCELLED'))]);
    expect(await screen.findByText('This payment was cancelled')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to checkout' })).toHaveAttribute(
      'href',
      '/checkout/o-1',
    );
  });

  it('shows not found when the payment does not exist', async () => {
    renderQr([getRoute(404, { statusCode: 404, code: 'PAYMENT_NOT_FOUND', message: 'x' })]);
    expect(await screen.findByText("We couldn't find this payment")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to checkout' })).toBeInTheDocument();
  });

  it('keeps the QR and says Reconnecting when polling fails', async () => {
    vi.useFakeTimers();
    const { container } = renderQr([
      {
        method: 'GET',
        path: '/v1/payments/p-2',
        status: 200,
        responses: [
          { status: 200, body: pay('PENDING') },
          { status: 503, body: { statusCode: 503, code: 'UPSTREAM_UNAVAILABLE', message: 'x' } },
        ],
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows Still processing after the cap and Check again restarts', async () => {
    vi.useFakeTimers();
    renderQr([getRoute(200, pay('PENDING'))]);
    await act(() => vi.advanceTimersByTimeAsync(61_000));
    expect(screen.getByText('Still processing')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await act(() => vi.advanceTimersByTimeAsync(1100));
    expect(screen.getByText('Waiting for payment…')).toBeInTheDocument();
  });
});
