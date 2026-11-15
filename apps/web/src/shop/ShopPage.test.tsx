import { screen, waitFor, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { ShopPage } from './ShopPage';

const types = {
  data: [
    {
      code: 'GOLD',
      name: 'Gold',
      priceMinor: 10000,
      currency: 'AED',
      quota: 100,
      sold: 10,
      reserved: 5,
      available: 85,
    },
    {
      code: 'PREMIUM',
      name: 'Premium',
      priceMinor: 20000,
      currency: 'AED',
      quota: 100,
      sold: 0,
      reserved: 0,
      available: 100,
    },
    {
      code: 'VIP',
      name: 'VIP',
      priceMinor: 50000,
      currency: 'AED',
      quota: 100,
      sold: 100,
      reserved: 0,
      available: 0,
    },
  ],
};

const typesRoute: StubRoute = { method: 'GET', path: '/v1/ticket-types', status: 200, body: types };

function Where(): React.ReactElement {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderShop(routes: StubRoute[] = [typesRoute]) {
  const fetch = stubFetch(routes);
  const utils = renderWithApp(
    <Routes>
      <Route path="/" element={<ShopPage />} />
      <Route path="/checkout/:id" element={<Where />} />
    </Routes>,
    { fetch },
  );
  return { fetch, ...utils };
}

const stubOf = (name: string): HTMLElement => {
  const heading = screen.getByRole('heading', { name });
  return heading.closest('article') as HTMLElement;
};

const postCalls = (fetch: { calls: Request[] }): Request[] =>
  fetch.calls.filter((c) => c.method === 'POST');

describe('ShopPage', () => {
  it('renders three stubs with prices and availability', async () => {
    renderShop();
    expect(await screen.findByText(/AED\s100\.00/u)).toBeInTheDocument();
    expect(screen.getByText('85 left')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('stepper respects availability', async () => {
    const { user } = renderShop();
    await screen.findByText('Sold out');
    const vip = within(stubOf('VIP'));
    expect(vip.getByRole('button', { name: /increase/iu })).toBeDisabled();
    const gold = within(stubOf('Gold'));
    expect(gold.getByRole('button', { name: /decrease/iu })).toBeDisabled();
    for (let i = 0; i < 11; i += 1) {
      const plus = gold.getByRole('button', { name: /increase/iu });
      if (!(plus as HTMLButtonElement).disabled) await user.click(plus);
    }
    expect(gold.getByRole('status')).toHaveTextContent('10');
    expect(gold.getByRole('button', { name: /increase/iu })).toBeDisabled();
  });

  it('live total', async () => {
    const { user } = renderShop();
    await screen.findByText('Sold out');
    const gold = within(stubOf('Gold'));
    await user.click(gold.getByRole('button', { name: /increase/iu }));
    await user.click(gold.getByRole('button', { name: /increase/iu }));
    await user.click(within(stubOf('Premium')).getByRole('button', { name: /increase/iu }));
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && /^Total\s+AED\s400\.00$/u.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument();
  });

  it('checkout posts only selected lines and navigates', async () => {
    const { user, fetch } = renderShop([
      typesRoute,
      { method: 'POST', path: '/v1/orders', status: 201, body: { id: 'ord-1' } },
    ]);
    await screen.findByText('Sold out');
    expect(screen.getByRole('button', { name: 'Checkout' })).toBeDisabled();
    const plus = within(stubOf('Gold')).getByRole('button', { name: /increase/iu });
    await user.click(plus);
    await user.click(plus);
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/checkout/ord-1'));
    const posts = postCalls(fetch);
    expect(posts).toHaveLength(1);
    expect(await posts[0]!.json()).toEqual({ items: [{ ticketTypeCode: 'GOLD', quantity: 2 }] });
  });

  it('checkout button sends one order on double click', async () => {
    const { user, fetch } = renderShop([
      typesRoute,
      { method: 'POST', path: '/v1/orders', status: 201, body: { id: 'ord-1' } },
    ]);
    await screen.findByText('Sold out');
    await user.click(within(stubOf('Gold')).getByRole('button', { name: /increase/iu }));
    await user.dblClick(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    expect(postCalls(fetch)).toHaveLength(1);
  });

  it('sends one order when clicked again after the POST resolved but before navigation', async () => {
    // The wildcard route keeps ShopPage mounted after navigate(), like the gap before the commit.
    const fetch = stubFetch([
      typesRoute,
      { method: 'POST', path: '/v1/orders', status: 201, body: { id: 'ord-1' } },
    ]);
    const { user } = renderWithApp(
      <Routes>
        <Route path="*" element={<ShopPage />} />
      </Routes>,
      { fetch },
    );
    await screen.findByText('Sold out');
    await user.click(within(stubOf('Gold')).getByRole('button', { name: /increase/iu }));
    const checkout = screen.getByRole('button', { name: 'Checkout' });
    await user.click(checkout);
    await waitFor(() => expect(postCalls(fetch)).toHaveLength(1));
    await waitFor(() => expect(checkout).toBeDisabled());
    await user.click(checkout);
    expect(postCalls(fetch)).toHaveLength(1);
  });

  it('quota exceeded shows message and refetches', async () => {
    const { user, fetch } = renderShop([
      typesRoute,
      {
        method: 'POST',
        path: '/v1/orders',
        status: 409,
        body: { status: 409, code: 'QUOTA_EXCEEDED', message: 'x', correlationId: 'c' },
      },
    ]);
    await screen.findByText('Sold out');
    await user.click(within(stubOf('Gold')).getByRole('button', { name: /increase/iu }));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough tickets left');
    await waitFor(() =>
      expect(
        fetch.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/v1/ticket-types')),
      ).toHaveLength(2),
    );
  });

  it('shows the rate limit message', async () => {
    const { user } = renderShop([
      typesRoute,
      {
        method: 'POST',
        path: '/v1/orders',
        status: 429,
        body: { status: 429, code: 'RATE_LIMITED', message: 'x', correlationId: 'c' },
      },
    ]);
    await screen.findByText('Sold out');
    await user.click(within(stubOf('Gold')).getByRole('button', { name: /increase/iu }));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests, try again shortly',
    );
  });

  it('shows a retry banner when the list fails', async () => {
    renderShop([
      {
        method: 'GET',
        path: '/v1/ticket-types',
        status: 502,
        body: { status: 502, code: 'UPSTREAM_UNAVAILABLE', message: 'x', correlationId: 'c' },
      },
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again.',
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('clamps quantities to the refetched availability and keeps the clamp', async () => {
    const goldWith = (available: number) => ({
      data: types.data.map((t) => (t.code === 'GOLD' ? { ...t, available } : t)),
    });
    const quota = {
      status: 409,
      body: { status: 409, code: 'QUOTA_EXCEEDED', message: 'x', correlationId: 'c' },
    };
    const { user, fetch } = renderShop([
      {
        method: 'GET',
        path: '/v1/ticket-types',
        status: 200,
        responses: [
          { status: 200, body: types },
          { status: 200, body: goldWith(1) },
          { status: 200, body: goldWith(85) },
        ],
      },
      {
        method: 'POST',
        path: '/v1/orders',
        status: 409,
        responses: [quota, quota, { status: 201, body: { id: 'ord-9' } }],
      },
    ]);
    await screen.findByText('Sold out');
    const gold = within(stubOf('Gold'));
    await user.click(gold.getByRole('button', { name: /increase/iu }));
    await user.click(gold.getByRole('button', { name: /increase/iu }));
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(gold.getByRole('status')).toHaveTextContent('1'));
    // Availability grows again: the clamped quantity stays 1.
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(screen.getByText('85 left')).toBeInTheDocument());
    expect(gold.getByRole('status')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Checkout' }));
    await waitFor(() => expect(screen.getByTestId('where')).toBeInTheDocument());
    const posts = postCalls(fetch);
    expect(await posts[0]!.json()).toEqual({ items: [{ ticketTypeCode: 'GOLD', quantity: 2 }] });
    expect(await posts[1]!.json()).toEqual({ items: [{ ticketTypeCode: 'GOLD', quantity: 1 }] });
    expect(await posts[2]!.json()).toEqual({ items: [{ ticketTypeCode: 'GOLD', quantity: 1 }] });
  });
});
