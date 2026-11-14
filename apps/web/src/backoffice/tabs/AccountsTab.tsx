import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useApi } from '../../api/client';
import { call } from '../../api/errors';
import { formatMinor } from '../../lib/money';
import { Loading, QueryFailure } from '../QueryFailure';
import styles from '../tables.module.css';

const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

export function AccountsTab(): ReactElement {
  const api = useApi();
  const q = useQuery({
    queryKey: ['backoffice', 'accounts'],
    queryFn: () => call(api.GET('/v1/backoffice/accounts')),
  });

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
              <tr key={a.code}>
                <td>{a.code}</td>
                <td>{a.name}</td>
                <td>{titleCase(a.type)}</td>
                <td className={styles.num}>{formatMinor(a.debitMinor, a.currency)}</td>
                <td className={styles.num}>{formatMinor(a.creditMinor, a.currency)}</td>
                <td className={styles.num}>{formatMinor(a.balanceMinor, a.currency)}</td>
              </tr>
            ))}
            <tr className={styles.total}>
              <td colSpan={3}>Totals</td>
              <td className={styles.num}>{formatMinor(totals.debitMinor, currency)}</td>
              <td className={styles.num}>{formatMinor(totals.creditMinor, currency)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className={`${styles.status} ${balanced ? styles.ok : styles.bad}`}>
        {balanced ? 'Balanced' : 'Out of balance'}
      </p>
    </>
  );
}
