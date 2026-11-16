import type { ReactElement } from 'react';
import { formatMinor } from '../lib/money';
import { Stepper } from '../ui/Stepper';
import { TicketStub } from '../ui/TicketStub';
import { maxFor } from './maxFor';
import styles from './ShopPage.module.css';
import type { OrderLine } from './useOrderCheckout';

export function TicketList({
  lines,
  onChange,
}: {
  lines: OrderLine[];
  onChange: (code: string, quantity: number) => void;
}): ReactElement {
  return (
    <div className={styles.list}>
      {lines.map((t) => (
        <TicketStub
          key={t.code}
          tier={t.code}
          stub={
            <Stepper
              label={t.name}
              value={t.quantity}
              min={0}
              max={maxFor(t)}
              onChange={(n) => onChange(t.code, n)}
            />
          }
        >
          <h2 className={styles.name}>{t.name}</h2>
          <p className={styles.price}>{formatMinor(t.priceMinor, t.currency)}</p>
          <p className={styles.left}>{t.available > 0 ? `${t.available} left` : 'Sold out'}</p>
        </TicketStub>
      ))}
    </div>
  );
}
