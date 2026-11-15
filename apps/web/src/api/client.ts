import type { Gateway } from '@eticket/contracts';
import createClient, { type Client } from 'openapi-fetch';
import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react';

export type Api = Client<Gateway.paths>;

const BACKOFFICE_PREFIX = '/v1/backoffice/';

export function createApi(
  opts: { baseUrl?: string; fetch?: typeof fetch; getToken?: () => string | null } = {},
): Api {
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  let baseUrl = opts.baseUrl ?? (envBase || '/api');
  // Node's Request rejects relative URLs; browsers resolve them. Resolve at runtime so no
  // absolute gateway URL is baked into the bundle.
  if (baseUrl.startsWith('/') && typeof globalThis.location !== 'undefined') {
    baseUrl = new URL(baseUrl, globalThis.location.origin).toString().replace(/\/$/u, '');
  }
  const basePath = new URL(baseUrl, 'https://placeholder.invalid').pathname.replace(/\/$/u, '');

  const api = createClient<Gateway.paths>({
    baseUrl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  api.use({
    onRequest({ request }) {
      const token = opts.getToken?.() ?? null;
      const path = new URL(request.url).pathname;
      if (token && path.startsWith(`${basePath}${BACKOFFICE_PREFIX}`)) {
        request.headers.set('Authorization', `Bearer ${token}`);
      }
      return request;
    },
  });
  return api;
}

const ApiContext = createContext<Api | null>(null);

export function ApiProvider(props: { api: Api; children: ReactNode }): ReactElement {
  return createElement(ApiContext.Provider, { value: props.api }, props.children);
}

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <ApiProvider>');
  return api;
}
