import type { ReactElement } from 'react';
import { formatMinor } from '../../lib/money';
import { useAvailability } from '../queries';
import { Loading, QueryFailure } from '../QueryFailure';
import styles from '../tables.module.css';

export function AvailabilityTab(): ReactElement {
  const q = useAvailability();

  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryFailure error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col" className={styles.num}>
              Price
            </th>
            <th scope="col" className={styles.num}>
              Quota
            </th>
            <th scope="col" className={styles.num}>
              Sold
            </th>
            <th scope="col" className={styles.num}>
              Reserved
            </th>
            <th scope="col" className={styles.num}>
              Available
            </th>
          </tr>
        </thead>
        <tbody>
          {q.data.data.map((t) => (
            <tr key={t.code}>
              <td>{t.name}</td>
              <td className={styles.num}>{formatMinor(t.priceMinor, t.currency)}</td>
              <td className={styles.num}>{t.quota}</td>
              <td className={styles.num}>{t.sold}</td>
              <td className={styles.num}>{t.reserved}</td>
              <td className={styles.num}>{t.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
