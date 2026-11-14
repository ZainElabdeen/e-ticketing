import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useApi, type Api } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { CardDetails, Order } from '../api/types';
import { formatMinor } from '../lib/money';
import { formatRemaining } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { TicketStub } from '../ui/TicketStub';
import { CardForm } from './CardForm';
import styles from './CheckoutPage.module.css';
import { newIdempotencyKey, submitPayment } from './pay';
import { recallPayment, rememberPayment } from './paymentMemory';
import { useCountdown } from './useCountdown';

type Method = 'CARD' | 'QR';
type BannerState = { tone: 'error' | 'info'; text: string };

const GENERIC = 'Something went wrong on our side. Try again.';
const TIER_NAMES: Record<string, string> = { GOLD: 'Gold', PREMIUM: 'Premium', VIP: 'VIP' };

const orderKey = (orderId: string) => ['order', orderId] as const;

function StartOver(): ReactElement {
  return (
    <Link to="/" className={styles.link}>
      Start over
    </Link>
  );
}

export function CheckoutPage(): ReactElement {
  const { orderId = '' } = useParams();
  const api = useApi();
  // True while another window holds the payment: refetch the order until it settles.
  const [otherWindow, setOtherWindow] = useState(false);

  const order = useQuery({
    queryKey: orderKey(orderId),
    queryFn: () => call(api.GET('/v1/orders/{orderId}', { params: { path: { orderId } } })),
    refetchOnWindowFocus: false,
    retry: (count, e) => !(e instanceof ApiError && e.status < 500) && count < 2,
    refetchInterval: (q) => (otherWindow && q.state.data?.status === 'PENDING' ? 2000 : false),
  });

  if (order.isPending) return <p className={styles.quiet}>Loading your order…</p>;
  // A failed background refetch keeps the data: only a first-load failure replaces the page.
  if (order.isError && order.data === undefined) {
    const notFound = order.error instanceof ApiError && order.error.status === 404;
    return (
      <section>
        <h1 className={styles.head}>Your order</h1>
        <Banner>{notFound ? "We couldn't find this order" : GENERIC}</Banner>
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
      reconnecting={order.isRefetchError}
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
  const orderId = order.id;
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [method, setMethod] = useState<Method>(search.get('method') === 'qr' ? 'QR' : 'CARD');
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [notPayable, setNotPayable] = useState(false);
  const [paidElsewhere, setPaidElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // null = the next submit makes a fresh key (lazily, no randomUUID per render).
  const key = useRef<string | null>(null);
  const { remainingMs, expired } = useCountdown(order.expiresAt);

  const newKey = useCallback(() => {
    key.current = null;
  }, []);

  const paid = order.status === 'CONFIRMED' || paidElsewhere;
  const recalled = paid ? recallPayment(orderId) : null;
  const recalledId = recalled?.paymentId;
  useEffect(() => {
    if (recalledId) void navigate(`/result/${recalledId}`, { replace: true });
  }, [recalledId, navigate]);

  const goToResultOrPaid = (): void => {
    const known = recallPayment(orderId);
    if (known) void navigate(`/result/${known.paymentId}`, { replace: true });
    else setPaidElsewhere(true);
  };

  // Maps a failed submit to the spec §5 table. Returns true when it handled the error.
  const handleError = (e: unknown, setNumberError?: (m: string) => void): void => {
    if (!(e instanceof ApiError)) {
      setBanner({ tone: 'error', text: GENERIC });
      return;
    }
    switch (e.code) {
      case 'INVALID_CARD':
        setNumberError?.('Check the card number and expiry date');
        return;
      case 'ORDER_NOT_PAYABLE':
        setNotPayable(true);
        return;
      case 'PAYMENT_IN_PROGRESS': {
        const known = recallPayment(orderId);
        if (known?.method === 'QR') {
          void navigate(`/checkout/${orderId}/qr/${known.paymentId}`);
          return;
        }
        setBanner({
          tone: 'info',
          text: 'A payment for this order is already running in another window',
        });
        setOtherWindow(true);
        return;
      }
      case 'ORDER_ALREADY_PAID':
        goToResultOrPaid();
        return;
      case 'RATE_LIMITED':
        setBanner({ tone: 'error', text: 'Too many requests, try again shortly' });
        return;
      default:
        setBanner({ tone: 'error', text: GENERIC });
    }
  };

  const pay = async (
    method: Method,
    card?: CardDetails,
    setNumberError?: (m: string) => void,
  ): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const body = card
        ? ({ orderId, method: 'CARD', card } as const)
        : ({ orderId, method: 'QR' } as const);
      key.current ??= newIdempotencyKey();
      const result = await submitPayment(api, body, key.current, {
        onKey: (k) => {
          key.current = k;
        },
      });
      key.current = result.key;
      rememberPayment(orderId, { paymentId: result.payment.id, method });
      void navigate(
        method === 'CARD'
          ? `/result/${result.payment.id}`
          : `/checkout/${orderId}/qr/${result.payment.id}`,
      );
    } catch (e) {
      inFlight.current = false;
      setBusy(false);
      handleError(e, setNumberError);
    }
    // On success the page stays locked until the navigation unmounts it, so a second click
    // during the route change cannot send another payment.
  };

  const total = formatMinor(order.totalMinor, order.currency);
  const gone = order.status === 'EXPIRED' || notPayable;
  const payDisabled = busy || expired || otherWindow;

  if (paid) {
    return (
      <section>
        <h1 className={styles.head}>Your order</h1>
        {recalled ? null : (
          <>
            <p className={styles.notice}>This order is already paid</p>
            <StartOver />
          </>
        )}
      </section>
    );
  }

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

      <TicketStub tier="NEUTRAL" stub={<p className={styles.amount}>{total}</p>}>
        <ul className={styles.lines}>
          {order.items.map((item) => (
            <li key={item.ticketTypeCode} className={styles.line}>
              <span className={styles.lineName}>
                {TIER_NAMES[item.ticketTypeCode] ?? item.ticketTypeCode} × {item.quantity}
              </span>
              <span>{formatMinor(item.lineTotalMinor, order.currency)}</span>
            </li>
          ))}
        </ul>
      </TicketStub>

      {gone || expired ? (
        <div className={styles.pane}>
          <p className={styles.notice}>This order has expired</p>
          <div className={styles.actions}>
            {gone ? null : (
              <Button disabled>{method === 'CARD' ? `Pay ${total}` : 'Show QR code'}</Button>
            )}
            <StartOver />
          </div>
        </div>
      ) : (
        <>
          <fieldset className={styles.method}>
            <legend>How do you want to pay?</legend>
            <div className={styles.choices}>
              {(['CARD', 'QR'] as const).map((m) => (
                <label key={m} className={styles.choice}>
                  <input
                    type="radio"
                    name="method"
                    value={m}
                    checked={method === m}
                    onChange={() => {
                      setMethod(m);
                      newKey();
                    }}
                  />
                  {m === 'CARD' ? 'Credit card' : 'QR scan'}
                </label>
              ))}
            </div>
          </fieldset>

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
