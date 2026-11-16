import { createBrowserRouter, type RouteObject } from 'react-router';
import { ConsoleArea } from '../backoffice/ConsoleArea';
import { RequireAuth } from '../backoffice/RequireAuth';
import { CheckoutPage } from '../checkout/CheckoutPage';
import { ResultPage } from '../result/ResultPage';
import { ShopPage } from '../shop/ShopPage';
import { Layout } from './Layout';
import { Loading } from './Loading';
import { RouteError } from './RouteError';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    // Shown while the first route's chunk loads on a cold start.
    hydrateFallbackElement: <Loading />,
    children: [
      {
        // Inside Layout so the error page keeps the header links.
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <ShopPage /> },
          { path: '/checkout/:orderId', element: <CheckoutPage /> },
          {
            // Lazy: QrPage pulls qrcode.react, which only this page needs.
            path: '/checkout/:orderId/qr/:paymentId',
            lazy: async () => ({ Component: (await import('../qr/QrPage')).QrPage }),
          },
          { path: '/result/:paymentId', element: <ResultPage /> },
          {
            element: <ConsoleArea />,
            children: [
              {
                path: '/backoffice/login',
                lazy: async () => ({
                  Component: (await import('../backoffice/LoginPage')).LoginPage,
                }),
              },
              {
                path: '/backoffice',
                lazy: async () => {
                  const { BackofficePage } = await import('../backoffice/BackofficePage');
                  return {
                    element: (
                      <RequireAuth>
                        <BackofficePage />
                      </RequireAuth>
                    ),
                  };
                },
              },
            ],
          },
          {
            path: '*',
            loader: () => {
              // React Router's documented way to raise a 404 into the errorElement.
              // eslint-disable-next-line @typescript-eslint/only-throw-error
              throw new Response('Not Found', { status: 404 });
            },
          },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
