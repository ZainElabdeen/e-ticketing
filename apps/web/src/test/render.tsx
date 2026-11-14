import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ApiProvider, createApi } from '../api/client';

export type StubRoute = {
  method: string;
  path: string | RegExp;
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Optional response sequence: the nth match uses entry n (the last repeats). Overrides status/body. */
  responses?: Array<{ status: number; body?: unknown }>;
};

/**
 * A fetch that answers from a route table (no MSW, ADR-0023). Matches on method and URL path
 * with the `/api` prefix stripped. An unmatched request answers 599 so the test fails loudly.
 */
export function stubFetch(routes: StubRoute[]): typeof fetch & { calls: Request[] } {
  const calls: Request[] = [];
  const hits = new Map<StubRoute, number>();
  const stub = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    calls.push(request);
    const path = new URL(request.url).pathname.replace(/^\/api/u, '');
    const route = routes.find(
      (r) =>
        r.method.toUpperCase() === request.method &&
        (typeof r.path === 'string' ? r.path === path : r.path.test(path)),
    );
    if (!route) {
      return Promise.resolve(
        new Response(`No stub for ${request.method} ${path}`, { status: 599 }),
      );
    }
    const n = hits.get(route) ?? 0;
    hits.set(route, n + 1);
    const picked = route.responses?.[Math.min(n, route.responses.length - 1)] ?? route;
    const hasBody = picked.body !== undefined && picked.status !== 204;
    return Promise.resolve(
      new Response(hasBody ? JSON.stringify(picked.body) : null, {
        status: picked.status,
        headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...route.headers },
      }),
    );
  };
  return Object.assign(stub, { calls });
}

/**
 * Task 6 replaces this no-op with the real `AuthProvider` from `src/backoffice/AuthProvider`.
 * Keep it as the single seam: nothing else in `renderWithApp` changes.
 */
function AuthProviderPlaceholder({ children }: { children: ReactNode }): ReactElement {
  return <>{children}</>;
}

export function renderWithApp(
  ui: ReactElement,
  opts: { route?: string; fetch?: typeof fetch; path?: string } = {},
): RenderResult & { user: UserEvent } {
  const api = createApi({ fetch: opts.fetch ?? stubFetch([]) });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  const result = render(
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <AuthProviderPlaceholder>
          <MemoryRouter initialEntries={[opts.route ?? '/']}>
            {opts.path ? (
              <Routes>
                <Route path={opts.path} element={ui} />
              </Routes>
            ) : (
              ui
            )}
          </MemoryRouter>
        </AuthProviderPlaceholder>
      </QueryClientProvider>
    </ApiProvider>,
  );
  return { ...result, user };
}
