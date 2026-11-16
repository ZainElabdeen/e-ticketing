import { memo, type ReactElement } from 'react';
import { messageFor } from '../api/errors';
import { formatMinor } from '../lib/money';
import {
  REVENUE_ACCOUNT_CODE,
  TILE,
  useAccounts,
  useAvailability,
  useTransactions,
} from './queries';
import styles from './SummaryTiles.module.css';

type TileState = { isPending: boolean; isError: boolean; error: unknown };

function Tile(props: { label: string; q: TileState; value: () => string }): ReactElement {
  const { label, q, value } = props;
  const text = q.isError ? messageFor(q.error) : q.isPending ? '…' : value();
  return (
    <section aria-label={label} className={styles.tile}>
      <p className={styles.label}>{label}</p>
      <p className={q.isError ? styles.error : styles.value}>{text}</p>
    </section>
  );
}

// No props, so memo keeps tab and page URL changes from re-rendering it.
export const SummaryTiles = memo(function SummaryTiles(): ReactElement {
  const accounts = useAccounts(TILE);
  const transactions = useTransactions(1, TILE);
  const availability = useAvailability(TILE);
  return (
    <div className={styles.grid}>
      <Tile
        label="Revenue"
        q={accounts}
        value={() => {
          const revenue = accounts.data?.data.find((a) => a.code === REVENUE_ACCOUNT_CODE);
          return revenue ? formatMinor(revenue.balanceMinor, revenue.currency) : '—';
        }}
      />
      <Tile label="Transactions" q={transactions} value={() => String(transactions.data?.total)} />
      <Tile
        label="Tickets left"
        q={availability}
        value={() => {
          const rows = availability.data?.data ?? [];
          const sum = (pick: (r: (typeof rows)[number]) => number): number =>
            rows.reduce((n, r) => n + pick(r), 0);
          return `${sum((r) => r.available)} / ${sum((r) => r.quota)}`;
        }}
      />
    </div>
  );
});
