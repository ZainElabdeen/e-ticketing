import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../ui/Button';
import styles from './ConsoleShell.module.css';

type Props = { nav: ReactNode; children: ReactNode; onSignOut: () => void };

/**
 * One DOM for every width: CSS turns the side column into a top bar with a scrolling nav
 * strip below 1024px.
 */
export function ConsoleShell({ nav, children, onSignOut }: Props): ReactElement {
  return (
    <div className={styles.shell}>
      <div className={styles.side}>
        <span className={styles.wordmark}>E-Ticket</span>
        <div className={styles.nav}>{nav}</div>
        <div className={styles.actions}>
          <Link to="/" className={styles.shop}>
            Shop
          </Link>
          <Button variant="quiet" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
