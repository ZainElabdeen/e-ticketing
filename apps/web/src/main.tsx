import './zod-setup';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApiProvider, createApi } from './api/client';
import { isRetryable } from './api/errors';
import { AuthProvider } from './backoffice/AuthProvider';
import { getSessionToken } from './backoffice/session';
import { createRouter } from './app/router';
import './styles/global.css';

const api = createApi({ getToken: getSessionToken });
const queryClient = new QueryClient({
  defaultOptions: {
    // Client errors (4xx, including 401 and 429) are not retried; network errors and 5xx twice.
    queries: { retry: (count, e) => count < 2 && isRetryable(e) },
  },
});
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </ApiProvider>
  </StrictMode>,
);
