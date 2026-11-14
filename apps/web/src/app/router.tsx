import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { BackofficePage } from '../backoffice/BackofficePage';
import { LoginPage } from '../backoffice/LoginPage';
import { CheckoutPage } from '../checkout/CheckoutPage';
import { QrPage } from '../qr/QrPage';
import { ResultPage } from '../result/ResultPage';
import { ShopPage } from '../shop/ShopPage';
import { Layout } from './Layout';

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <ShopPage /> },
      { path: '/checkout/:orderId', element: <CheckoutPage /> },
      { path: '/checkout/:orderId/qr/:paymentId', element: <QrPage /> },
      { path: '/result/:paymentId', element: <ResultPage /> },
      { path: '/backoffice/login', element: <LoginPage /> },
      { path: '/backoffice', element: <BackofficePage /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
