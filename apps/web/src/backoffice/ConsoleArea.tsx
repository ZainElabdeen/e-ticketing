import type { ReactElement } from 'react';
import { Outlet } from 'react-router';
import styles from './ConsoleArea.module.css';

/** Scopes the console row padding and paints the surface for everything below it. */
export function ConsoleArea(): ReactElement {
  return (
    <div data-area="console" className={styles.area}>
      <Outlet />
    </div>
  );
}
