import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useApi } from '../api/client';
import { ApiError, call, isRetryable, messageFor } from '../api/errors';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { CheckoutBody } from './CheckoutBody';
import { StartOver } from './CheckoutClosed';
import styles from './CheckoutPage.module.css';

const orderKey = (orderId: string) => ['order', orderId] as const;

export function CheckoutPage(): ReactElement {
  useDocumentTitle('Your order');
  const { orderId = '' } = useParams();
  const api = useApi();
  // True while another window holds the payment: refetch the order until it settles.
  const [otherWindow, setOtherWindow] = useState(false);

  const order = useQuery({
    queryKey: orderKey(orderId),
    queryFn: () => call(api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } })),
    refetchOnWindowFocus: false,
    retry: (count, e) => count < 2 && isRetryable(e),
    refetchInterval: (q) => (otherWindow && q.state.data?.status === 'PENDING' ? 2000 : false),
  });

  if (order.isPending) return <p className={styles.quiet}>Loading your order…</p>;
  // A failed background refetch keeps the data: only a first-load failure replaces the page.
  if (order.isError && order.data === undefined) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return (
      <section>
        <h1 className={styles.head}>Your order</h1>
        <Banner>{notFound ? "We couldn't find this order" : messageFor(order.error)}</Banner>
        <div className={styles.actions}>
          {notFound ? null : (
            <Button variant="quiet" onClick={() => void order.refetch()}>
              Try again
            </Button>
          )}
          <StartOver />
        </div>
      </section>
    );
  }
  return (
    <CheckoutBody
      api={api}
      order={order.data}
      otherWindow={otherWindow}
      setOtherWindow={setOtherWindow}
      reconnecting={otherWindow && order.isRefetchError}
      refetch={() => void order.refetch()}
    />
  );
}
