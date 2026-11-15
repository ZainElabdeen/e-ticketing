import type { ReactElement } from 'react';
import { Link, Outlet } from 'react-router';
import styles from './Layout.module.css';

export function Layout(): ReactElement {
  return (
    <>
      <header className={styles.header}>
        <Link to="/" className={styles.wordmark}>
          E-Ticket
        </Link>
        <Link to="/backoffice">Backoffice</Link>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </>
  );
}
