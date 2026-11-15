import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByRole('link', { name: 'Start over' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'E-Ticket' })).toBeInTheDocument();
  });
});
