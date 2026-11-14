import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link, useParams } from 'react-router';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { Payment } from '../api/types';
import { formatMinor } from '../lib/money';
import { formatDateTime } from '../lib/time';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import styles from './ResultPage.module.css';

const GENERIC = 'Something went wrong on our side. Try again.';

function Row(props: { label: string; children: React.ReactNode }): ReactElement {
  return (
    <div className={styles.row}>
      <dt>{props.label}</dt>
      <dd>{props.children}</dd>
    </div>
  );
}

function Receipt({ payment }: { payment: Payment }): ReactElement {
  const tx = payment.transaction;
  return (
    <section className={styles.receipt}>
      <div className={styles.head}>
        <h1 className={styles.title}>Payment received</h1>
        <span aria-hidden="true" className={styles.stamp}>
          PAID
        </span>
      </div>
      <p className={styles.amount}>
        {formatMinor(payment.amountMinor, payment.currency)}
        <span className={styles.visuallyHidden}> Paid in full</span>
      </p>
      <dl className={styles.rows}>
        {tx ? (
          <>
            <Row label="Transaction ID">{tx.transactionId}</Row>
            <Row label="Payment reference">{tx.paymentReference}</Row>
            <Row label="Time">
              <time dateTime={tx.createdAt}>{formatDateTime(tx.createdAt)}</time>
            </Row>
          </>
        ) : null}
        <Row label="Paid with">
          {payment.method === 'CARD' && payment.cardLast4
            ? `Card ending ${payment.cardLast4}`
            : 'QR scan'}
        </Row>
        <Row label="Order">{payment.orderId}</Row>
      </dl>
      <div className={styles.actions}>
        <Link to="/" className={styles.link}>
          Buy more tickets
        </Link>
      </div>
    </section>
  );
}

export function ResultPage(): ReactElement {
  const { paymentId = '' } = useParams();
  const api = useApi();
  const query = useQuery({
    queryKey: ['payment', paymentId],
    queryFn: () => call(api.GET('/v1/payments/{paymentId}', { params: { path: { paymentId } } })),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const payment = query.data;

  if (query.isPending) return <p className={styles.loading}>Loading your receipt…</p>;

  if (!payment) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <section>
        <h1 className={styles.title}>Payment</h1>
        <Banner>{notFound ? "We couldn't find this payment" : GENERIC}</Banner>
        <div className={styles.actions}>
          {notFound ? null : (
            <Button variant="quiet" onClick={() => void query.refetch()}>
              Try again
            </Button>
          )}
          <Link to="/" className={styles.link}>
            Start over
          </Link>
        </div>
      </section>
    );
  }

  if (payment.status === 'SUCCEEDED') return <Receipt payment={payment} />;

  const pending = payment.status === 'PENDING';
  return (
    <section>
      <h1 className={styles.title}>Payment</h1>
      <Banner tone="info">
        {pending ? 'This payment is still processing' : 'This payment was cancelled'}
      </Banner>
      <div className={styles.actions}>
        {pending ? (
          <Link to={`/checkout/${payment.orderId}/qr/${payment.id}`} className={styles.link}>
            Show QR code
          </Link>
        ) : (
          <Link to="/" className={styles.link}>
            Start over
          </Link>
        )}
      </div>
    </section>
  );
}
