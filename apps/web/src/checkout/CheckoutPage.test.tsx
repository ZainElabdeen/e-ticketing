import { act, fireEvent, screen, waitFor } from '@testing-library/react';
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
    const [first, second] = posts(fetch.calls);
    expect(first!.headers.get('idempotency-key')).not.toBe(second!.headers.get('idempotency-key'));
    const sent = (await second!.clone().json()) as { card: { number: string } };
    expect(sent.card.number).toBe('5555555555554444');
  });

  it('ties the inline card error to its field', async () => {
    const { user } = renderCheckout([orderRoute(), payRoute(409, errBody(409, 'INVALID_CARD'))]);
    await fillCard(user);
    await user.click(screen.getByRole('button', { name: /Pay AED/u }));
    const message = await screen.findByText('Check the card number and expiry date');
    const input = screen.getByLabelText('Card number');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);
    expect(message).toHaveAttribute('role', 'alert');
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

  it('shows the rate limit text when the first order load is rate limited', async () => {
    renderCheckout([orderRoute(errBody(429, 'RATE_LIMITED') as never, { status: 429 })]);
    expect(await screen.findByText('Too many requests, try again shortly')).toBeInTheDocument();
  });

  it('shows not found for a missing order', async () => {
    renderCheckout([orderRoute(errBody(404, 'ORDER_NOT_FOUND') as never, { status: 404 })]);
    expect(await screen.findByText("We couldn't find this order")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start over' })).toBeInTheDocument();
  });

  it('POST ORDER_ALREADY_PAID goes to the remembered result', async () => {
    rememberPayment('o-1', { paymentId: 'p-5', method: 'CARD' });
    const { user } = renderCheckout([
      orderRoute(),
      payRoute(409, errBody(409, 'ORDER_ALREADY_PAID')),
    ]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/result/p-5'));
  });

  it('POST ORDER_ALREADY_PAID without memory says paid and offers a way forward', async () => {
    const { user } = renderCheckout([
      orderRoute(),
      payRoute(409, errBody(409, 'ORDER_ALREADY_PAID')),
    ]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    expect(await screen.findByText('This order is already paid')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
  });

  it('POST ORDER_NOT_PAYABLE shows the expired view without Pay', async () => {
    const { user } = renderCheckout([
      orderRoute(),
      payRoute(409, errBody(409, 'ORDER_NOT_PAYABLE')),
    ]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    expect(await screen.findByText('This order has expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay|Show QR/u })).not.toBeInTheDocument();
  });

  it('switching method makes a new key', async () => {
    const { fetch, user } = renderCheckout([
      orderRoute(),
      payRoute(429, errBody(429, 'RATE_LIMITED')),
    ]);
    await user.click(await screen.findByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    await screen.findByText('Too many requests, try again shortly');
    await user.click(screen.getByLabelText('Credit card'));
    await user.click(screen.getByLabelText('QR scan'));
    await user.click(screen.getByRole('button', { name: 'Show QR code' }));
    await waitFor(() => expect(posts(fetch.calls)).toHaveLength(2));
    const [a, b] = posts(fetch.calls).map((c) => c.headers.get('idempotency-key'));
    expect(a).not.toBe(b);
  });
  it('keeps the payment method in the URL', async () => {
    function Search(): React.ReactElement {
      return <p data-testid="search">{useLocation().search}</p>;
    }
    const { user } = renderWithApp(
      <>
        <Search />
        <Routes>
          <Route path="/checkout/:orderId" element={<CheckoutPage />} />
        </Routes>
      </>,
      { fetch: stubFetch([orderRoute()]), route: '/checkout/o-1?foo=1' },
    );
    await user.click(await screen.findByLabelText('QR scan'));
    expect(screen.getByTestId('search')).toHaveTextContent('foo=1');
    expect(screen.getByTestId('search')).toHaveTextContent('method=qr');
    expect(screen.getByLabelText('QR scan')).toBeChecked();
    await user.click(screen.getByLabelText('Credit card'));
    expect(screen.getByTestId('search')).toHaveTextContent('method=card');
    expect(screen.getByLabelText('Credit card')).toBeChecked();
  });
});

describe('CheckoutPage under fake timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  const click = (name: string | RegExp) =>
    act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
      await vi.advanceTimersByTimeAsync(0);
    });
  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const startQr = async () => {
    await tick(50);
    await click('Show QR code');
  };
  const qrRoute = '/checkout/o-1?method=qr';

  it.each([
    ['UPSTREAM_UNAVAILABLE', 502],
    ['INTERNAL_ERROR', 500],
  ])('shows the generic banner for %s after retries', async (code, status) => {
    const { fetch } = renderCheckout(
      [orderRoute(), payRoute(status, errBody(status, code))],
      qrRoute,
    );
    await startQr();
    await tick(2000);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again.',
    );
    expect(posts(fetch.calls)).toHaveLength(3);
  });

  it('shows the generic banner for a network error', async () => {
    const inner = stubFetch([orderRoute()]);
    const offline = Object.assign(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Request(input, init).method === 'POST'
          ? Promise.reject(new TypeError('offline'))
          : inner(input, init),
      { calls: inner.calls },
    ) as unknown as typeof fetch;
    renderWithApp(
      <Routes>
        <Route path="/checkout/:orderId" element={<CheckoutPage />} />
      </Routes>,
      { fetch: offline, route: qrRoute },
    );
    await startQr();
    await tick(2000);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again.',
    );
  });

  it('keeps the key actually used after IDEMPOTENCY_KEY_REUSE then a failure', async () => {
    const { fetch } = renderCheckout(
      [
        orderRoute(),
        payRoute(502, null, {
          responses: [
            { status: 422, body: errBody(422, 'IDEMPOTENCY_KEY_REUSE') },
            { status: 502, body: errBody(502, 'UPSTREAM_UNAVAILABLE') },
          ],
        }),
      ],
      qrRoute,
    );
    await startQr();
    await tick(2000);
    const used = posts(fetch.calls).map((c) => c.headers.get('idempotency-key'));
    expect(used[1]).not.toBe(used[0]);
    await click('Show QR code');
    await tick(2000);
    const all = posts(fetch.calls).map((c) => c.headers.get('idempotency-key'));
    expect(all[used.length]).toBe(used[used.length - 1]);
  });

  it('does not bind the reuse key to a body edited while the first request was in flight', async () => {
    const inner = stubFetch([
      orderRoute(),
      payRoute(502, null, {
        responses: [
          { status: 422, body: errBody(422, 'IDEMPOTENCY_KEY_REUSE') },
          { status: 502, body: errBody(502, 'UPSTREAM_UNAVAILABLE') },
        ],
      }),
    ]);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let held = false;
    const gated = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new Request(input, init).method === 'POST' && !held) {
          held = true;
          await gate;
        }
        return inner(input, init);
      },
      { calls: inner.calls },
    ) as unknown as typeof fetch;
    renderWithApp(
      <Routes>
        <Route path="/checkout/:orderId" element={<CheckoutPage />} />
      </Routes>,
      { fetch: gated, route: qrRoute },
    );
    await startQr();
    // Switch method and back while the first POST is still pending: the key is reset.
    // Each click is its own act: the URL owns the method, so the radio only flips after the
    // navigation renders.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Credit card'));
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('QR scan'));
      await vi.advanceTimersByTimeAsync(0);
    });
    release();
    await tick(2500);
    const used = posts(inner.calls).map((c) => c.headers.get('idempotency-key'));
    expect(used).toHaveLength(4);
    await click('Show QR code');
    await tick(0);
    const all = posts(inner.calls).map((c) => c.headers.get('idempotency-key'));
    expect(all[4]).not.toBe(used[3]);
    expect(all[4]).not.toBe(used[0]);
  });

  it('keeps the form and shows Reconnecting when a refetch fails, and polling stops once paid', async () => {
    const { fetch } = renderCheckout([
      orderRoute(order(), {
        responses: [
          { status: 200, body: order() },
          { status: 429, body: errBody(429, 'RATE_LIMITED') },
          { status: 200, body: order({ status: 'CONFIRMED' }) },
        ],
      }),
      payRoute(409, errBody(409, 'PAYMENT_IN_PROGRESS')),
    ]);
    await tick(50);
    fill('Name on card', 'Jane Doe');
    fill('Card number', '4242 4242 4242 4242');
    fill('Expiry (MM/YY)', '12/39');
    fill('Security code', '123');
    await click(/Pay AED/u);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(
      'A payment for this order is already running in another window',
    );
    expect(status).toHaveAttribute('aria-live', 'polite');

    await tick(2100);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(screen.getByLabelText('Card number')).toHaveValue('4242 4242 4242 4242');
    expect(screen.getByLabelText('Name on card')).toHaveValue('Jane Doe');

    await tick(2100);
    expect(screen.getByText('This order is already paid')).toBeInTheDocument();
    const gets = fetch.calls.filter((c) => c.method === 'GET').length;
    await tick(10_000);
    expect(fetch.calls.filter((c) => c.method === 'GET').length).toBe(gets);
  });

  it('drops Reconnecting once Check again is pressed even if the refetch fails again', async () => {
    renderCheckout(
      [
        orderRoute(order(), {
          responses: [
            { status: 200, body: order() },
            { status: 429, body: errBody(429, 'RATE_LIMITED') },
          ],
        }),
        payRoute(409, errBody(409, 'PAYMENT_IN_PROGRESS')),
      ],
      qrRoute,
    );
    await startQr();
    await tick(2100);
    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    await click('Check again');
    await tick(50);
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument();
  });

  it('Check again clears the other-window state and refetches', async () => {
    const { fetch } = renderCheckout(
      [orderRoute(), payRoute(409, errBody(409, 'PAYMENT_IN_PROGRESS'))],
      qrRoute,
    );
    await startQr();
    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeDisabled();
    const before = fetch.calls.filter((c) => c.method === 'GET').length;
    await click('Check again');
    await tick(50);
    expect(fetch.calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show QR code' })).toBeEnabled();
  });
});
