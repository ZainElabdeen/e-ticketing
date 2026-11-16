import type { ReactElement } from 'react';
import { Link } from 'react-router';
import { Button } from '../ui/Button';
import type { Method } from './MethodPicker';
import styles from './CheckoutPage.module.css';

export function StartOver(): ReactElement {
  return (
    <Link to="/" className={styles.link}>
      Start over
    </Link>
  );
}

type Props =
  | { kind: 'paid'; recalled: boolean }
  | { kind: 'expired'; gone: boolean; method: Method; total: string };

/** The two dead ends of checkout: an order already paid, or one that can no longer be paid. */
export function CheckoutClosed(props: Props): ReactElement {
  if (props.kind === 'paid') {
    return (
      <section>
        <h1 className={styles.head}>Your order</h1>
        {props.recalled ? null : (
          <>
            <p className={styles.notice}>This order is already paid</p>
            <StartOver />
          </>
        )}
      </section>
    );
  }
  const { gone, method, total } = props;
  return (
    <div className={`${styles.pane} ${styles.closed}`}>
      <p className={styles.notice}>This order has expired</p>
      <div className={styles.actions}>
        {gone ? null : (
          <Button disabled>{method === 'CARD' ? `Pay ${total}` : 'Show QR code'}</Button>
        )}
        <StartOver />
      </div>
    </div>
  );
}
