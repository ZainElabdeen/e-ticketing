import { useIsFetching } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import styles from './BackofficePage.module.css';

/**
 * Muted note while data the user asked for (a section or page change invalidates it) refreshes
 * behind data already on screen. The 15 s interval refetches are not invalidated, so they stay silent.
 */
export function UpdatingNote(): ReactElement {
  const refreshing =
    useIsFetching({
      queryKey: ['backoffice'],
      predicate: (query) => query.state.data !== undefined && query.state.isInvalidated,
    }) > 0;
  return (
    <p className={styles.updating} aria-live="polite">
      {refreshing ? 'Updating…' : ''}
    </p>
  );
}
