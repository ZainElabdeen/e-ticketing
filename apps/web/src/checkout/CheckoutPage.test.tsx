import { act, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { CheckoutPage } from './CheckoutPage';
import { recallPayment, rememberPayment } from './paymentMemory';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  status: 'PENDING',
  items: [
    { ticketTypeCode: 'GOLD', quantity: 2, unitPriceMinor: 10000, lineTotalMinor: 20000 },
    { ticketTypeCode: 'VIP', quantity: 1, unitPriceMinor: 50000, lineTotalMinor: 50000 },
  ],
  totalMinor: 70000,
  currency: 'AED',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 14 * 60_000 + 55_000).toISOString(),
  confirmedAt: null,
  paidTransactionId: null,
  ...over,
});

const orderRoute = (body = order(), extra: Partial<StubRoute> = {}): StubRoute => ({
  method: 'GET',
  path: '/v1/orders/o-1',
  status: 200,
  body,
  ...extra,
});
const payRoute = (status: number, body: unknown, extra: Partial<StubRoute> = {}): StubRoute => ({
  method: 'POST',
  path: '/v1/payments',
  status,
  body,
  ...extra,
});
const errBody = (status: number, code: string) => ({ statusCode: status, code, message: code });
const payment = (method: 'CARD' | 'QR') => ({
  id: method === 'CARD' ? 'p-1' : 'p-2',
  orderId: 'o-1',
  method,
  status: method === 'CARD' ? 'SUCCEEDED' : 'PENDING',
  amountMinor: 70000,
  currency: 'AED',
});

function Where(): React.ReactElement {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function renderCheckout(routes: StubRoute[], route = '/checkout/o-1') {
  const fetch = stubFetch(routes);
  const utils = renderWithApp(
    <Routes>
      <Route path="/checkout/:orderId" element={<CheckoutPage />} />
      <Route path="*" element={<Where />} />
    </Routes>,
    { fetch, route },
  );
  return { fetch, ...utils };
}

const fillCard = async (
  user: ReturnType<typeof renderCheckout>['user'],
  number = '4242 4242 4242 4242',
) => {
  await user.type(await screen.findByLabelText('Name on card'), 'Jane Doe');
  await user.type(screen.getByLabelText('Card number'), number);
  await user.type(screen.getByLabelText('Expiry (MM/YY)'), '12/39');
  await user.type(screen.getByLabelText('Security code'), '123');
};

const posts = (calls: Request[]) => calls.filter((c) => c.method === 'POST');

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe('CheckoutPage', () => {
  it('checkout loads from the URL alone', async () => {
    const { fetch } = renderCheckout([orderRoute()]);
    expect(await screen.findAllByText(/AED\s700\.00/u)).not.toHaveLength(0);
    expect(screen.getByText(/Valid for 14:5/u)).toBeInTheDocument();
    expect(fetch.calls[0]?.url).toContain('/v1/orders/o-1');
    expect(screen.getByText(/Gold × 2/u)).toBeInTheDocument();
  });

  it('card pay success navigates to result', async () => {
    const { fetch, user } = renderCheckout([orderRoute(), payRoute(201, payment('CARD'))]);
    await fillCard(user);
    await user.click(screen.getByRole('button', { name: /Pay AED\s700\.00/u }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-1'));
    const post = posts(fetch.calls)[0]!;
    const sent = (await post.clone().json()) as Record<string, unknown>;
    expect(sent).toMatchObject({
      orderId: 'o-1',
      method: 'CARD',
      card: {
        number: '4242424242424242',
        expMonth: 12,
        expYear: 2039,
        cvc: '123',
        holder: 'Jane Doe',
      },
    });
    expect(post.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(recallPayment('o-1')).toEqual({ paymentId: 'p-1', method: 'CARD' });
    expect(JSON.stringify(window.sessionStorage)).not.toContain('4242');
  });

  it('pay sends one payment on double click', async () => {
    const { fetch, user } = renderCheckout([orderRoute(), payRoute(201, payment('CARD'))]);
    await fillCard(user);
    await user.dblClick(screen.getByRole('button', { name: /Pay AED/u }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-1'));
    expect(posts(fetch.calls)).toHaveLength(1);
  });

  it('editing the form makes a new key', async () => {
    const { fetch, user } = renderCheckout([
      orderRoute(),
      payRoute(409, errBody(409, 'INVALID_CARD'), {
        responses: [{ status: 409, body: errBody(409, 'INVALID_CARD') }],
      }),
    ]);
    await fillCard(user);
    await user.click(screen.getByRole('button', { name: /Pay AED/u }));
    expect(await screen.findByText('Check the card number and expiry date')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Card number'));
    await user.type(screen.getByLabelText('Card number'), '5555 5555 5555 4444');
    await user.click(screen.getByRole('button', { name: /Pay AED/u }));
    await waitFor(() => expect(posts(fetch.calls)).toHaveLength(2));
    const [a, b] = posts(fetch.calls).map((c) => c.headers.get('idempotency-key'));
    expect(a).not.toBe(b);
  });

  it('countdown at zero disables pay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderCheckout([orderRoute(order({ expiresAt: new Date(Date.now() + 2000).toISOString() }))]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByRole('button', { name: /Pay AED/u })).toBeEnabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole('button', { name: /Pay AED/u })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Start over' })).toBeInTheDocument();
    expect(screen.getByText('This order has expired')).toBeInTheDocument();
  });

  it('QR start navigates to the QR page', async () => {
    const { fetch, user } = renderCheckout([orderRoute(), payRoute(201, payment('QR'))]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/checkout/o-1/qr/p-2'),
    );
    expect(await posts(fetch.calls)[0]!.clone().json()).toEqual({ orderId: 'o-1', method: 'QR' });
    expect(recallPayment('o-1')).toEqual({ paymentId: 'p-2', method: 'QR' });
  });

  it('method comes from the query string', async () => {
    renderCheckout([orderRoute()], '/checkout/o-1?method=qr');
    expect(await screen.findByRole('button', { name: 'Show QR code' })).toBeInTheDocument();
  });

  it('payment in progress resumes the remembered QR payment', async () => {
    rememberPayment('o-1', { paymentId: 'p-9', method: 'QR' });
    const { user } = renderCheckout([
      orderRoute(),
      payRoute(409, errBody(409, 'PAYMENT_IN_PROGRESS')),
    ]);
    await fillCard(user);
    await user.click(screen.getByRole('button', { name: /Pay AED/u }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/checkout/o-1/qr/p-9'),
    );
  });

  it('payment in progress without memory polls the order', async () => {
    const { fetch, user } = renderCheckout([
      orderRoute(order(), {
        responses: [
          { status: 200, body: order() },
          { status: 200, body: order({ status: 'CONFIRMED' }) },
        ],
      }),
      payRoute(409, errBody(409, 'PAYMENT_IN_PROGRESS')),
    ]);
    await fillCard(user);
    await user.click(screen.getByRole('button', { name: /Pay AED/u }));
    expect(
      await screen.findByText('A payment for this order is already running in another window'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('This order is already paid', {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(fetch.calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('order already paid goes to result when remembered', async () => {
    rememberPayment('o-1', { paymentId: 'p-1', method: 'CARD' });
    renderCheckout([orderRoute(order({ status: 'CONFIRMED' }))]);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-1'));
  });

  it('confirmed order without memory says it is paid', async () => {
    renderCheckout([orderRoute(order({ status: 'CONFIRMED' }))]);
    expect(await screen.findByText('This order is already paid')).toBeInTheDocument();
  });

  it('expired order shows start over', async () => {
    renderCheckout([orderRoute(order({ status: 'EXPIRED' }))]);
    expect(await screen.findByText('This order has expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: /Pay/u })).not.toBeInTheDocument();
  });

  it('maps rate limit and upstream errors to banners', async () => {
    const { user } = renderCheckout([orderRoute(), payRoute(429, errBody(429, 'RATE_LIMITED'))]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    expect(await screen.findByText('Too many requests, try again shortly')).toBeInTheDocument();
  });

  it('shows not found for a missing order', async () => {
    renderCheckout([orderRoute(errBody(404, 'ORDER_NOT_FOUND') as never, { status: 404 })]);
    expect(await screen.findByText("We couldn't find this order")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start over' })).toBeInTheDocument();
  });
});
