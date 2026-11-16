import { useIsFetching, type QueryKey } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import styles from './BackofficePage.module.css';

/**
 * Muted note while the section the user just opened refreshes behind data already on screen.
 * Interval and tile refetches stay silent: only the active section's query counts, and only
 * while `navigating` (the 2 s after the user opened a section or page).
 */
export function UpdatingNote(props: { queryKey: QueryKey; navigating: boolean }): ReactElement {
  const { queryKey, navigating } = props;
  const fetching =
    useIsFetching({
      queryKey,
      exact: true,
      predicate: (query) => query.state.data !== undefined,
    }) > 0;
  const refreshing = fetching && navigating;
  return (
    <p className={styles.updating} aria-live="polite">
      {refreshing ? 'Updating…' : ''}
    </p>
  );
}
