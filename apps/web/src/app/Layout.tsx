import { useEffect, useRef, type ReactElement } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import styles from './Layout.module.css';

export function Layout(): ReactElement {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const previous = useRef(pathname);

  // After a route change, move focus to the page so keyboard and screen-reader users start at
  // the top of the new content. Not on first render, and not for query-string-only changes.
  // Focus goes to <main>: page headings are not mounted yet while a page is still loading.
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    main.current?.focus();
  }, [pathname]);

  // The console draws its own shell, so the shop header and main padding step aside.
  const inConsole = pathname === '/backoffice' || pathname.startsWith('/backoffice/');

  return (
    <>
      {inConsole ? null : (
        <header className={styles.header}>
          <Link to="/" className={styles.wordmark}>
            E-Ticket
          </Link>
          <Link to="/backoffice">Backoffice</Link>
        </header>
      )}
      <main
        ref={main}
        tabIndex={-1}
        className={inConsole ? `${styles.main} ${styles.console}` : styles.main}
      >
        <Outlet />
      </main>
    </>
  );
}
