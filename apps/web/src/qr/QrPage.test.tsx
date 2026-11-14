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
    // GET stays PENDING until the cancel POST is recorded, so SUCCEEDED can only come from the
    // refetch after the 409.
    const pending = stubFetch([getRoute(200, pay('PENDING'))]);
    const done = stubFetch([
      getRoute(200, pay('SUCCEEDED')),
      cancelRoute(409, { statusCode: 409, code: 'PAYMENT_NOT_CANCELLABLE', message: 'x' }),
    ]);
    const calls: Request[] = [];
    const fetch = Object.assign<typeof globalThis.fetch, { calls: Request[] }>(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(input, init);
        calls.push(req);
        const posted = calls.some((c) => c.method === 'POST');
        return (posted || req.method === 'POST' ? done : pending)(req);
      },
      { calls },
    );
    const { user } = renderWithApp(
      <Routes>
        <Route path="/checkout/:orderId/qr/:paymentId" element={<QrPage />} />
        <Route path="*" element={<Where />} />
      </Routes>,
      { fetch, route: '/checkout/o-1/qr/p-2' },
    );
    await user.click(await screen.findByRole('button', { name: 'Use card instead' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-2'));
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('cancel conflict on a still pending payment says so', async () => {
    const { user } = renderQr([
      getRoute(200, pay('PENDING')),
      cancelRoute(409, { statusCode: 409, code: 'PAYMENT_NOT_CANCELLABLE', message: 'x' }),
    ]);
    await user.click(await screen.findByRole('button', { name: 'Use card instead' }));
    expect(
      await screen.findByText("That payment can't be switched right now. Try again."),
    ).toBeInTheDocument();
  });

  it('use card instead sends one cancel on double click', async () => {
    const { fetch, user } = renderQr([
      getRoute(200, pay('PENDING')),
      cancelRoute(200, pay('CANCELLED')),
    ]);
    await user.dblClick(await screen.findByRole('button', { name: 'Use card instead' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('method=card'));
    expect(fetch.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('recovers from a 503 on first load', async () => {
    vi.useFakeTimers();
    renderQr([
      {
        method: 'GET',
        path: '/v1/payments/p-2',
        status: 200,
        responses: [
          { status: 503, body: { statusCode: 503, code: 'UPSTREAM_UNAVAILABLE', message: 'x' } },
          { status: 200, body: pay('PENDING') },
          { status: 200, body: pay('SUCCEEDED') },
        ],
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByText('Loading your payment…')).toBeInTheDocument();
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(screen.queryByText("We couldn't find this payment")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2200));
    expect(screen.getByTestId('where')).toHaveTextContent('/result/p-2');
  });

  it('waits out a 429 on first load, then recovers', async () => {
    vi.useFakeTimers();
    const { fetch } = renderQr([
      {
        method: 'GET',
        path: '/v1/payments/p-2',
        status: 200,
        headers: { 'Retry-After': '3' },
        responses: [
          { status: 429, body: { statusCode: 429, code: 'RATE_LIMITED', message: 'x' } },
          { status: 200, body: pay('PENDING') },
        ],
      },
    ]);
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(fetch.calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(fetch.calls).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1200));
    expect(fetch.calls).toHaveLength(2);
    expect(screen.getByText('Scan to pay')).toBeInTheDocument();
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

  it('stops polling on a 404', async () => {
    vi.useFakeTimers();
    const { fetch } = renderQr([
      getRoute(404, { statusCode: 404, code: 'PAYMENT_NOT_FOUND', message: 'x' }),
    ]);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText("We couldn't find this payment")).toBeInTheDocument();
    expect(fetch.calls).toHaveLength(1);
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
