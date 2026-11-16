import { type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import type { Api } from '../api/client';
import type { Order } from '../api/types';
import { formatMinor } from '../lib/money';
import { formatRemaining } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { StickyBar } from '../ui/StickyBar';
import { CardForm } from './CardForm';
import { CheckoutClosed, StartOver } from './CheckoutClosed';
import styles from './CheckoutPage.module.css';
import { MethodPicker, type Method } from './MethodPicker';
import { OrderSummary } from './OrderSummary';
import { useCheckoutPayment } from './useCheckoutPayment';
import { useCountdown } from './useCountdown';

export function CheckoutBody(props: {
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

  const countdown = gone ? null : (
    <span role="timer">Valid for {formatRemaining(remainingMs)}</span>
  );

  return (
    <section>
      <h1 className={styles.head}>Your order</h1>
      {reconnecting ? <p className={styles.quiet}>Reconnecting…</p> : null}

      <div className={styles.layout}>
        <div className={styles.summary}>
          <OrderSummary order={order} total={total} countdown={countdown} />
        </div>

        {gone || expired ? (
          <CheckoutClosed kind="expired" gone={gone} method={method} total={total} />
        ) : (
          <div className={styles.payment}>
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
                <StickyBar>
                  <Button disabled={payDisabled} onClick={() => void pay('QR')}>
                    Show QR code
                  </Button>
                </StickyBar>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
