import type { ReactElement } from 'react';
import { formatMinor } from '../../lib/money';
import { useAvailability } from '../queries';
import { Loading, QueryFailure } from '../QueryFailure';
import { LabeledCell } from '../LabeledCell';
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
            <tr key={t.code} className={styles.row}>
              <LabeledCell label="Type">{t.name}</LabeledCell>
              <LabeledCell label="Price" className={styles.num}>
                {formatMinor(t.priceMinor, t.currency)}
              </LabeledCell>
              <LabeledCell label="Quota" className={styles.num}>
                {t.quota}
              </LabeledCell>
              <LabeledCell label="Sold" className={styles.num}>
                {t.sold}
              </LabeledCell>
              <LabeledCell label="Reserved" className={styles.num}>
                {t.reserved}
              </LabeledCell>
              <LabeledCell label="Available" className={`${styles.num} ${styles.lead}`}>
                {t.available}
              </LabeledCell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
