import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { ApiProvider, createApi } from './api/client';
import { createRouter } from './app/router';
import './styles/global.css';

const api = createApi();
const queryClient = new QueryClient();
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiProvider api={api}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ApiProvider>
  </StrictMode>,
);
