import type { ReactElement } from 'react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { Banner } from '../ui/Banner';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import styles from './RouteError.module.css';

export function RouteError(): ReactElement {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  useDocumentTitle(notFound ? 'Page not found' : 'Something went wrong');
  return (
    <section>
      <h1>{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      {notFound ? null : <Banner>Something went wrong. Please start over and try again.</Banner>}
      <div className={styles.actions}>
        <Link to="/" className={styles.link}>
          Start over
        </Link>
      </div>
    </section>
  );
}
