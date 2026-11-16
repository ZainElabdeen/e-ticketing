import { useDocumentTitle } from '../lib/useDocumentTitle';
import { useState, type ReactElement } from 'react';
import { messageFor } from '../api/errors';
import type { TicketType } from '../api/types';
import { formatMinor, sumMinor } from '../lib/money';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { StickyBar } from '../ui/StickyBar';
import { maxFor } from './maxFor';
import styles from './ShopPage.module.css';
import { TicketList } from './TicketList';
import { useOrderCheckout } from './useOrderCheckout';
import { useTicketTypes } from './useTicketTypes';

export function ShopPage(): ReactElement {
  useDocumentTitle('Pick your tickets');
  const types = useTicketTypes();
  const [selected, setSelected] = useState<Record<string, number>>({});

  const list = types.data ?? [];
  // Clamp at read time so a refetch with lower availability never leaves an over-max quantity.
  const quantityOf = (t: TicketType): number => Math.min(selected[t.code] ?? 0, maxFor(t));
  const lines = list.map((t) => ({ ...t, quantity: quantityOf(t) }));
  const total = sumMinor(lines);
  const count = lines.reduce((n, l) => n + l.quantity, 0);
  const currency = list[0]?.currency ?? 'AED';
  const { checkout, error, locked } = useOrderCheckout(lines, total, setSelected);

  return (
    <section>
      <h1 className={styles.title}>Pick your tickets</h1>
      {error ? <Banner>{error}</Banner> : null}
      {types.isPending ? <p className={styles.quiet}>Loading tickets…</p> : null}
      {types.isError ? (
        <div>
          <Banner>{messageFor(types.error)}</Banner>
          <Button variant="quiet" onClick={() => void types.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {list.length > 0 ? (
        <>
          <TicketList
            lines={lines}
            onChange={(code, n) => setSelected((s) => ({ ...s, [code]: n }))}
          />
          <StickyBar>
            {count > 0 ? (
              <p className={styles.count}>{count === 1 ? '1 ticket' : `${count} tickets`}</p>
            ) : null}
            <p className={styles.total}>
              Total <strong>{formatMinor(total, currency)}</strong>
            </p>
            <Button disabled={total === 0 || locked} onClick={checkout}>
              Checkout
            </Button>
          </StickyBar>
        </>
      ) : null}
    </section>
  );
}
