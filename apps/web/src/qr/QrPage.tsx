import { useMutation, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import { forgetPayment } from '../checkout/paymentMemory';
import { formatMinor } from '../lib/money';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { TicketStub } from '../ui/TicketStub';
import styles from './QrPage.module.css';
import { paymentKey, usePaymentPolling } from './usePaymentPolling';

const GENERIC = 'Something went wrong on our side. Try again.';

export function QrPage(): ReactElement {
  const { orderId = '', paymentId = '' } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { payment, state, reconnecting, restart } = usePaymentPolling(paymentId);

  useEffect(() => {
    if (state === 'succeeded') void navigate(`/result/${paymentId}`, { replace: true });
  }, [state, paymentId, navigate]);

  const cancel = useMutation({
    mutationFn: () =>
      call(api.POST('/v1/payments/{paymentId}/cancel', { params: { path: { paymentId } } })),
    onSuccess: () => {
      forgetPayment(orderId);
      void navigate(`/checkout/${orderId}?method=card`, { replace: true });
    },
    onError: async (e) => {
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

  if (!payment) {
    if (reconnecting) {
      return (
        <section>
          <h1 className={styles.title}>Scan to pay</h1>
          <Banner>{"We couldn't find this payment"}</Banner>
          <div className={styles.actions}>{back}</div>
        </section>
      );
    }
    return <p className={styles.quiet}>Loading your payment…</p>;
  }

  if (state === 'cancelled') {
    return (
      <section>
        <h1 className={styles.title}>Scan to pay</h1>
        <Banner>This payment was cancelled</Banner>
        <div className={styles.actions}>{back}</div>
      </section>
    );
  }

  const conflict =
    cancel.error instanceof ApiError && cancel.error.code === 'PAYMENT_NOT_CANCELLABLE';
  const cancelFailed = cancel.isError && !conflict;
  const timeout = state === 'timeout';

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

      <div aria-live="polite" className={styles.status}>
        <p>{timeout ? 'Still processing' : 'Waiting for payment…'}</p>
        {reconnecting ? <p className={styles.quiet}>Reconnecting…</p> : null}
      </div>
      {cancelFailed ? <Banner>{GENERIC}</Banner> : null}

      <div className={styles.actions}>
        {timeout ? <Button onClick={restart}>Check again</Button> : null}
        <Button
          variant="quiet"
          disabled={cancel.isPending}
          onClick={() => {
            if (!cancel.isPending) cancel.mutate();
          }}
        >
          Use card instead
        </Button>
      </div>
    </section>
  );
}
