import type { ReactElement } from 'react';
import { formatMinor } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { Pagination } from '../../ui/Pagination';
import { useTransactions } from '../queries';
import { Loading, QueryFailure } from '../QueryFailure';
import styles from '../tables.module.css';
import { PAGE_SIZE, useClampPage, type TabProps } from '../usePage';

const METHODS: Record<string, string> = { CARD: 'Card', QR: 'QR' };

export function TransactionsTab({ page, onPage }: TabProps): ReactElement {
  const q = useTransactions(page);
  useClampPage(page, q.data?.total, onPage);

  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryFailure error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.total === 0) {
    return (
      <p className={styles.quiet}>No transactions yet. Buy a ticket in the shop to see one here.</p>
    );
  }
  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Payment reference</th>
              <th scope="col">Transaction ID</th>
              <th scope="col">Order</th>
              <th scope="col">Method</th>
              <th scope="col" className={styles.num}>
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {q.data.data.map((t) => (
              <tr key={t.transactionId}>
                <td>{formatDateTime(t.createdAt)}</td>
                <td>{t.paymentReference}</td>
                <td>
                  <span title={t.transactionId}>{t.transactionId.slice(0, 8)}</span>
                </td>
                <td>
                  <span title={t.orderId}>{t.orderId.slice(0, 8)}</span>
                </td>
                <td>{METHODS[t.method] ?? t.method}</td>
                <td className={styles.num}>{formatMinor(t.amountMinor, t.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={q.data.total} pageSize={PAGE_SIZE} onPage={onPage} />
    </>
  );
}
