import type { ReactElement } from 'react';
import { ApiError, messageFor } from '../api/errors';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import styles from './tables.module.css';

/** Transient tab error (429, 5xx, network). A 401 is handled by the AuthProvider, not here. */
export function QueryFailure(props: { error: unknown; onRetry: () => void }): ReactElement | null {
  const { error, onRetry } = props;
  if (error instanceof ApiError && error.status === 401) return null;
  return (
    <div>
      <Banner>{messageFor(error)}</Banner>
      <div className={styles.failure}>
        <Button variant="quiet" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function Loading(): ReactElement {
  return <p className={styles.quiet}>Loading…</p>;
}
