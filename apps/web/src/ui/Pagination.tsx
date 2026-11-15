import type { ReactElement } from 'react';
import { Button } from './Button';
import styles from './Pagination.module.css';

export function lastPageOf(total: number, pageSize: number): number {
  return Math.ceil(total / pageSize) || 1;
}

export function Pagination(props: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}): ReactElement {
  const { page, total, pageSize, onPage } = props;
  const last = lastPageOf(total, pageSize);
  return (
    <nav className={styles.bar} aria-label="Pagination">
      <p className={styles.label}>{`Page ${page} of ${last}`}</p>
      <div className={styles.buttons}>
        <Button variant="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <Button variant="quiet" disabled={page >= last} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
