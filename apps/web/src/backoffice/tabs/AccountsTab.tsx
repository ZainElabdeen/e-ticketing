import type { ReactElement } from 'react';
import { formatMinor } from '../../lib/money';
import { useAccounts } from '../queries';
import { Loading, QueryFailure } from '../QueryFailure';
import { LabeledCell } from '../LabeledCell';
import styles from '../tables.module.css';

const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

export function AccountsTab(): ReactElement {
  const q = useAccounts();

  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryFailure error={q.error} onRetry={() => void q.refetch()} />;
  const { data: accounts, totals } = q.data;
  const currency = accounts[0]?.currency ?? 'AED';
  const balanced = totals.debitMinor === totals.creditMinor;
  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col" className={styles.num}>
                Debit
              </th>
              <th scope="col" className={styles.num}>
                Credit
              </th>
              <th scope="col" className={styles.num}>
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.code} className={styles.row}>
                <LabeledCell label="Code">{a.code}</LabeledCell>
                <LabeledCell label="Name">{a.name}</LabeledCell>
                <LabeledCell label="Type">{titleCase(a.type)}</LabeledCell>
                <LabeledCell label="Debit" className={styles.num}>
                  {formatMinor(a.debitMinor, a.currency)}
                </LabeledCell>
                <LabeledCell label="Credit" className={styles.num}>
                  {formatMinor(a.creditMinor, a.currency)}
                </LabeledCell>
                <LabeledCell label="Balance" className={`${styles.num} ${styles.lead}`}>
                  {formatMinor(a.balanceMinor, a.currency)}
                </LabeledCell>
              </tr>
            ))}
            <tr className={`${styles.total} ${styles.row}`}>
              <td colSpan={3}>Totals</td>
              <LabeledCell label="Debit" className={styles.num}>
                {formatMinor(totals.debitMinor, currency)}
              </LabeledCell>
              <LabeledCell label="Credit" className={styles.num}>
                {formatMinor(totals.creditMinor, currency)}
              </LabeledCell>
              <td className={styles.emptyCell} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className={styles.status}>
        <span className={`${styles.pill} ${balanced ? styles.ok : styles.bad}`}>
          {balanced ? 'Balanced' : 'Out of balance'}
        </span>
      </p>
    </>
  );
}
