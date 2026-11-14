import type { ReactElement } from 'react';
import { ApiError } from '../api/errors';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import styles from './tables.module.css';

const GENERIC = 'Something went wrong on our side. Try again.';

/** Transient tab error (429, 5xx, network). A 401 is handled by the AuthProvider, not here. */
export function QueryFailure(props: { error: unknown; onRetry: () => void }): ReactElement | null {
  const { error, onRetry } = props;
  if (error instanceof ApiError && error.status === 401) return null;
  const text =
    error instanceof ApiError && error.code === 'RATE_LIMITED'
      ? 'Too many requests, try again shortly'
      : GENERIC;
  return (
    <div>
      <Banner>{text}</Banner>
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
