import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useDocumentTitle } from '../app/useDocumentTitle';
import { useApi, type Api } from '../api/client';
import { ApiError, call, isRetryable, messageFor } from '../api/errors';
import type { Order } from '../api/types';
import { formatMinor } from '../lib/money';
import { formatRemaining } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { CardForm } from './CardForm';
import { CheckoutClosed, StartOver } from './CheckoutClosed';
import styles from './CheckoutPage.module.css';
import { MethodPicker, type Method } from './MethodPicker';
import { OrderSummary } from './OrderSummary';
import { useCheckoutPayment } from './useCheckoutPayment';
import { useCountdown } from './useCountdown';

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

function CheckoutBody(props: {
  api: Api;
  order: Order;
  otherWindow: boolean;
  setOtherWindow: (v: boolean) => void;
  reconnecting: boolean;
  refetch: () => void;
}): ReactElement {
  const { api, order, otherWindow, setOtherWindow, reconnecting, refetch } = props;
  const [search, setSearch] = useSearchParams();
  // The URL owns the method, so a refresh keeps the choice.
  const method: Method = search.get('method') === 'qr' ? 'QR' : 'CARD';
  const { remainingMs, expired } = useCountdown(order.expiresAt);
  const { busy, banner, setBanner, notPayable, paid, recalled, newKey, pay } = useCheckoutPayment({
    api,
    order,
    setOtherWindow,
  });

  const total = formatMinor(order.totalMinor, order.currency);
  const gone = order.status === 'EXPIRED' || notPayable;
  const payDisabled = busy || expired || otherWindow;

  if (paid) return <CheckoutClosed kind="paid" recalled={recalled} />;

  const changeMethod = (m: Method): void => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('method', m === 'QR' ? 'qr' : 'card');
        return next;
      },
      { replace: true },
    );
    newKey();
  };

  return (
    <section>
      <div className={styles.head}>
        <h1>Your order</h1>
        {gone ? null : (
          <p className={styles.countdown} role="timer">
            Valid for {formatRemaining(remainingMs)}
          </p>
        )}
      </div>
      {reconnecting ? <p className={styles.quiet}>Reconnecting…</p> : null}

      <OrderSummary order={order} total={total} />

      {gone || expired ? (
        <CheckoutClosed kind="expired" gone={gone} method={method} total={total} />
      ) : (
        <>
          <MethodPicker method={method} onChange={changeMethod} />

          <div className={styles.pane}>
            {banner ? <Banner tone={banner.tone}>{banner.text}</Banner> : null}
            {otherWindow ? (
              <div className={styles.actions}>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setOtherWindow(false);
                    setBanner(null);
                    refetch();
                  }}
                >
                  Check again
                </Button>
                <StartOver />
              </div>
            ) : null}
            {method === 'CARD' ? (
              <CardForm
                payLabel={`Pay ${total}`}
                disabled={payDisabled}
                onEdit={newKey}
                onSubmit={(card, setNumberError) => pay('CARD', card, setNumberError)}
              />
            ) : (
              <Button disabled={payDisabled} onClick={() => void pay('QR')}>
                Show QR code
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
