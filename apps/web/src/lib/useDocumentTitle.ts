import { useEffect } from 'react';

const SUFFIX = 'E-Ticket';

/** Sets `document.title` to "<page> · E-Ticket" while the calling page is mounted. */
export function useDocumentTitle(page: string): void {
  useEffect(() => {
    document.title = `${page} · ${SUFFIX}`;
  }, [page]);
}
