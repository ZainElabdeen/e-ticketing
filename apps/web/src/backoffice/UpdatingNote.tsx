import { useIsFetching } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import styles from './BackofficePage.module.css';

/** Muted note while backoffice data refreshes behind data already on screen. */
export function UpdatingNote(): ReactElement {
  const refreshing =
    useIsFetching({
      queryKey: ['backoffice'],
      predicate: (query) => query.state.data !== undefined,
    }) > 0;
  return (
    <p className={styles.updating} aria-live="polite">
      {refreshing ? 'Updating…' : ''}
    </p>
  );
}
