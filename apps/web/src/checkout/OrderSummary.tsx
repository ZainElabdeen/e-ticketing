import type { ReactElement, ReactNode } from 'react';
import type { Order } from '../api/types';
import { formatMinor } from '../lib/money';
import { TicketStub } from '../ui/TicketStub';
import styles from './CheckoutPage.module.css';

const TIER_NAMES: Record<string, string> = { GOLD: 'Gold', PREMIUM: 'Premium', VIP: 'VIP' };

export function OrderSummary(props: {
  order: Order;
  total: string;
  countdown?: ReactNode;
}): ReactElement {
  const { order, total, countdown } = props;
  return (
    <>
      {countdown}
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
    </>
  );
}
