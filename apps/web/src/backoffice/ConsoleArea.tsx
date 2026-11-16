import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import styles from './ConsoleArea.module.css';

/** Re-points the semantic tokens to the console palette for everything below it. */
export function ConsoleArea(): ReactElement {
  return (
    <div data-area="console" className={styles.area}>
      <Outlet />
    </div>
  );
}
