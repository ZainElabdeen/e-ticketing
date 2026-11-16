import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useApi } from '../../api/client';
import { call } from '../../api/errors';
import { formatMinor } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { Pagination } from '../../ui/Pagination';
import { Loading, QueryFailure } from '../QueryFailure';
import { LabeledCell } from '../LabeledCell';
import styles from '../tables.module.css';
import { PAGE_SIZE, useClampPage, type TabProps } from '../usePage';

const POSTING: Record<string, string> = {
  TICKET_SALE: 'Ticket sale',
  UNFULFILLED_PAYMENT: 'Unfulfilled payment',
};

export function LedgerEntriesTab({ page, onPage }: TabProps): ReactElement {
  const api = useApi();
  const q = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['backoffice', 'ledger-entries', page],
    queryFn: () =>
      call(
        api.GET('/v1/backoffice/ledger-entries', {
          params: { query: { page, pageSize: PAGE_SIZE } },
        }),
      ),
  });
  useClampPage(page, q.data?.total, onPage);

  if (q.isPending) return <Loading />;
  if (q.isError) return <QueryFailure error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.total === 0) return <p className={styles.quiet}>No ledger entries yet.</p>;
  return (
    <>
      <div className={styles.wrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className={styles.num}>
                Debit
              </th>
              <th scope="col" className={styles.num}>
                Credit
              </th>
            </tr>
          </thead>
          {q.data.data.map((entry) => {
            // Integer minor units: no floats.
            let debit = 0;
            let credit = 0;
            for (const line of entry.lines) {
              if (line.direction === 'DEBIT') debit += line.amountMinor;
              else credit += line.amountMinor;
            }
            return (
              <tbody key={entry.id} className={styles.entry}>
                <tr className={styles.group}>
                  <th scope="colgroup" colSpan={3}>
                    <span className={styles.hidden}>Posted </span>
                    <span>{formatDateTime(entry.postedAt)}</span>
                    <span className={styles.hidden}>Reference </span>
                    <span>{entry.paymentReference}</span>
                    <span className={styles.hidden}>Type </span>
                    <span>{POSTING[entry.postingType] ?? entry.postingType}</span>
                  </th>
                </tr>
                {entry.lines.map((line) => (
                  <tr key={line.id}>
                    <LabeledCell label="Account">{`${line.accountCode} ${line.accountName}`}</LabeledCell>
                    <LabeledCell label="Debit" className={styles.num}>
                      {line.direction === 'DEBIT'
                        ? formatMinor(line.amountMinor, entry.currency)
                        : ''}
                    </LabeledCell>
                    <LabeledCell label="Credit" className={styles.num}>
                      {line.direction === 'CREDIT'
                        ? formatMinor(line.amountMinor, entry.currency)
                        : ''}
                    </LabeledCell>
                  </tr>
                ))}
                <tr className={`${styles.total} ${debit === credit ? '' : styles.bad}`}>
                  <td>Totals</td>
                  <LabeledCell label="Debit" className={styles.num}>
                    {formatMinor(debit, entry.currency)}
                  </LabeledCell>
                  <LabeledCell label="Credit" className={styles.num}>
                    {formatMinor(credit, entry.currency)}
                  </LabeledCell>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      <Pagination page={page} total={q.data.total} pageSize={PAGE_SIZE} onPage={onPage} />
    </>
  );
}
