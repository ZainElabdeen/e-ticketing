import { memo, type ReactElement } from 'react';
import { messageFor } from '../api/errors';
import { formatMinor } from '../lib/money';
import { useSummary } from './queries';
import styles from './SummaryTiles.module.css';

type Summary = NonNullable<ReturnType<typeof useSummary>['data']>;

function Tile(props: { label: string; text: string; isError: boolean }): ReactElement {
  const { label, text, isError } = props;
  return (
    <section aria-label={label} className={styles.tile}>
      <p className={styles.label}>{label}</p>
      <p className={isError ? styles.error : styles.value}>{text}</p>
    </section>
  );
}

function texts(summary: Summary): [string, string, string] {
  const { revenue, transactionCount, tickets } = summary;
  return [
    formatMinor(revenue.amountMinor, revenue.currency),
    String(transactionCount),
    `${tickets.available} / ${tickets.quota}`,
  ];
}

// No props, so memo keeps tab and page URL changes from re-rendering it.
export const SummaryTiles = memo(function SummaryTiles(): ReactElement {
  const { data, isError, error } = useSummary();
  // One query feeds the strip, so it has one loading state and one error message.
  const values = data ? texts(data) : undefined;
  const fallback = isError ? messageFor(error) : '…';
  const shown = values ?? [fallback, fallback, fallback];
  return (
    <div className={styles.grid}>
      <Tile label="Revenue" text={shown[0]} isError={!values && isError} />
      <Tile label="Transactions" text={shown[1]} isError={!values && isError} />
      <Tile label="Tickets left" text={shown[2]} isError={!values && isError} />
    </div>
  );
});
