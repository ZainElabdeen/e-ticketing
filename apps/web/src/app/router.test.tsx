import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider, createApi } from '../api/client';
import { AuthProvider } from '../backoffice/AuthProvider';
import { stubFetch } from '../test/render';
import { Layout } from './Layout';
import { RouteError } from './RouteError';
import { routes } from './router';

afterEach(() => vi.restoreAllMocks());

describe('route errors', () => {
  it('renders a not-found page inside the shell for an unknown URL', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/nope'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Backoffice' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Page not found · E-Ticket'));
  });

  it('renders a generic error page when a route element throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Boom(): never {
      throw new Error('kaboom');
    }
    const router = createMemoryRouter(
      [
        {
          element: <Layout />,
          children: [
            { errorElement: <RouteError />, children: [{ path: '/', element: <Boom /> }] },
          ],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('kaboom')).toBeNull();
    await waitFor(() => expect(document.title).toBe('Something went wrong · E-Ticket'));
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'E-Ticket' })).toBeInTheDocument();
  });
});

describe('route code splitting', () => {
  const flat = (rs: RouteObject[]): RouteObject[] =>
    rs.flatMap((r) => [r, ...flat(r.children ?? [])]);

  it.each(['/backoffice', '/backoffice/login', '/checkout/:orderId/qr/:paymentId'])(
    'loads %s lazily',
    (path) => {
      const route = flat(routes).find((r) => r.path === path);
      expect(route?.lazy).toBeTypeOf('function');
    },
  );

  it('renders a lazy route once its chunk has loaded', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/backoffice/login'] });
    render(
      <ApiProvider api={createApi({ fetch: stubFetch([]) })}>
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </ApiProvider>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  });
});
