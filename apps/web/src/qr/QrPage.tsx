import { useEffect, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ApiError, messageFor } from '../api/errors';
import { formatMinor } from '../lib/money';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { TicketStub } from '../ui/TicketStub';
import { QrCode } from './QrCode';
import styles from './QrPage.module.css';
import { QrStatus } from './QrStatus';
import { useCancelPayment } from './useCancelPayment';
import { usePaymentPolling } from './usePaymentPolling';

export function QrPage(): ReactElement {
  useDocumentTitle('Scan to pay');
  const { orderId = '', paymentId = '' } = useParams();
  const navigate = useNavigate();
  const { payment, state, reconnecting, error, restart } = usePaymentPolling(paymentId);

  useEffect(() => {
    if (state === 'succeeded') void navigate(`/result/${paymentId}`, { replace: true });
  }, [state, paymentId, navigate]);

  const cancel = useCancelPayment(orderId, paymentId);

  const back = (
    <Link to={`/checkout/${orderId}`} className={styles.link}>
      Back to checkout
    </Link>
  );

  const notFound = !payment && error instanceof ApiError && error.status === 404;
  const timeout = state === 'timeout';

  // The key keeps the same DOM node when the branches below put it at a different child index.
  const live = (text: string | null) => (
    <QrStatus key="live" text={text} reconnecting={reconnecting && !notFound} />
  );

  if (notFound) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Payment</h1>
        {live(null)}
        <Banner>{"We couldn't find this payment"}</Banner>
        <div className={styles.actions}>{back}</div>
      </section>
    );
  }

  if (state === 'cancelled') {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Payment</h1>
        {live(null)}
        <Banner>This payment was cancelled</Banner>
        <div className={styles.actions}>{back}</div>
      </section>
    );
  }

  if (!payment) {
    return (
      <section className={styles.page}>
        <h1 className={styles.title}>Payment</h1>
        {live(timeout ? 'Still processing' : 'Loading your payment…')}
        <div className={styles.actions}>
          {timeout ? <Button onClick={restart}>Check again</Button> : null}
          {back}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Scan to pay</h1>
      <TicketStub
        tier="NEUTRAL"
        stub={<p className={styles.amount}>{formatMinor(payment.amountMinor, payment.currency)}</p>}
      >
        {payment.qrPayload ? (
          <QrCode payload={payment.qrPayload} />
        ) : (
          <Banner>{"We couldn't load this QR code"}</Banner>
        )}
      </TicketStub>

      {live(timeout ? 'Still processing' : 'Waiting for payment…')}
      {cancel.failed ? <Banner>{messageFor(cancel.error)}</Banner> : null}
      {cancel.conflict && !cancel.isPending ? (
        <Banner>{"That payment can't be switched right now. Try again."}</Banner>
      ) : null}

      <div className={styles.actions}>
        {timeout ? <Button onClick={restart}>Check again</Button> : null}
        <Button variant="quiet" disabled={cancel.isPending} onClick={cancel.run}>
          Use card instead
        </Button>
        {payment.qrPayload ? null : back}
      </div>
    </section>
  );
}
