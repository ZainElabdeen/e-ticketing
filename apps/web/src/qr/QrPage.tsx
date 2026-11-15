import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useDocumentTitle } from '../app/useDocumentTitle';
import { useApi } from '../api/client';
import { ApiError, call, messageFor } from '../api/errors';
import { forgetPayment } from '../checkout/paymentMemory';
import { formatMinor } from '../lib/money';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { TicketStub } from '../ui/TicketStub';
import styles from './QrPage.module.css';
import { paymentKey, usePaymentPolling } from './usePaymentPolling';

export function QrPage(): ReactElement {
  useDocumentTitle('Scan to pay');
  const { orderId = '', paymentId = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { payment, state, reconnecting, error, restart } = usePaymentPolling(paymentId);

  useEffect(() => {
    if (state === 'succeeded') void navigate(`/result/${paymentId}`, { replace: true });
  }, [state, paymentId, navigate]);

  // A ref, not isPending: two clicks can land before React re-renders the disabled button.
  const cancelling = useRef(false);
  const cancel = useMutation({
    mutationFn: () =>
      call(api.POST('/v1/payments/{paymentId}/cancel', { params: { path: { paymentId } } })),
    onSuccess: () => {
      forgetPayment(orderId);
      void navigate(`/checkout/${orderId}?method=card`, { replace: true });
    },
    onError: async (e) => {
      // Released on failure only: on success the page stays locked until navigation unmounts it.
      cancelling.current = false;
      if (e instanceof ApiError && e.code === 'PAYMENT_NOT_CANCELLABLE') {
        // Raced with the server: whatever the payment is now decides where we go.
        await queryClient.invalidateQueries({ queryKey: paymentKey(paymentId) });
      }
    },
  });

  const back = (
    <Link to={`/checkout/${orderId}`} className={styles.link}>
      Back to checkout
    </Link>
  );

  const notFound = !payment && error instanceof ApiError && error.status === 404;
  const conflict =
    cancel.error instanceof ApiError && cancel.error.code === 'PAYMENT_NOT_CANCELLABLE';
  const cancelFailed = cancel.isError && !conflict;
  const timeout = state === 'timeout';

  // Mounted from the first render so screen readers announce later text. The key keeps the same
  // DOM node when the branches below put it at a different child index.
  const live = (text: string | null) => (
    <div key="live" aria-live="polite" className={styles.status}>
      {text ? <p>{text}</p> : null}
      {reconnecting && !notFound ? <p className={styles.quiet}>Reconnecting…</p> : null}
    </div>
  );

  if (notFound) {
    return (
      <section>
        <h1 className={styles.title}>Payment</h1>
        {live(null)}
        <Banner>{"We couldn't find this payment"}</Banner>
        <div className={styles.actions}>{back}</div>
      </section>
    );
  }

  if (state === 'cancelled') {
    return (
      <section>
        <h1 className={styles.title}>Payment</h1>
        {live(null)}
        <Banner>This payment was cancelled</Banner>
        <div className={styles.actions}>{back}</div>
      </section>
    );
  }

  if (!payment) {
    return (
      <section>
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
    <section>
      <h1 className={styles.title}>Scan to pay</h1>
      <TicketStub
        tier="NEUTRAL"
        stub={<p className={styles.amount}>{formatMinor(payment.amountMinor, payment.currency)}</p>}
      >
        <div className={styles.code}>
          <QRCodeSVG value={payment.qrPayload ?? ''} size={224} level="M" title="Payment QR code" />
        </div>
        <p className={styles.hint}>
          Scan the code with your banking app. In this simulation the server completes the payment
          by itself after about 8 seconds.
        </p>
      </TicketStub>

      {live(timeout ? 'Still processing' : 'Waiting for payment…')}
      {cancelFailed ? <Banner>{messageFor(cancel.error)}</Banner> : null}
      {conflict && !cancel.isPending ? (
        <Banner>{"That payment can't be switched right now. Try again."}</Banner>
      ) : null}

      <div className={styles.actions}>
        {timeout ? <Button onClick={restart}>Check again</Button> : null}
        <Button
          variant="quiet"
          disabled={cancel.isPending}
          onClick={() => {
            if (cancelling.current) return;
            cancelling.current = true;
            cancel.mutate();
          }}
        >
          Use card instead
        </Button>
      </div>
    </section>
  );
}
