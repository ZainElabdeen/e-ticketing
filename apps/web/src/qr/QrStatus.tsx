import type { ReactElement } from 'react';
import styles from './QrPage.module.css';

/** Mounted from the first render so screen readers announce later text. */
export function QrStatus({
  text,
  reconnecting,
}: {
  text: string | null;
  reconnecting: boolean;
}): ReactElement {
  return (
    <div aria-live="polite" className={styles.status}>
      {text ? <p>{text}</p> : null}
      {reconnecting ? <p className={styles.quiet}>Reconnecting…</p> : null}
    </div>
  );
}
