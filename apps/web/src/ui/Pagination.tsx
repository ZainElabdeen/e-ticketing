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
      <p
        className={styles.label}
        aria-live="polite"
        aria-atomic="true"
      >{`Page ${page} of ${last}`}</p>
      <div className={styles.buttons}>
        {/* aria-disabled, not disabled: a disabled button would drop keyboard focus. */}
        <Button
          variant="quiet"
          aria-disabled={page <= 1}
          onClick={() => {
            if (page > 1) onPage(page - 1);
          }}
        >
          Prev
        </Button>
        <Button
          variant="quiet"
          aria-disabled={page >= last}
          onClick={() => {
            if (page < last) onPage(page + 1);
          }}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
