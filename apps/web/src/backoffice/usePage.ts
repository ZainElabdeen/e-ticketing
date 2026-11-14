import { useEffect } from 'react';
import { lastPageOf } from '../ui/Pagination';

export const PAGE_SIZE = 20;

/** Moves to the last page when the URL asks for one past it. */
export function useClampPage(
  page: number,
  total: number | undefined,
  onPage: (page: number, replace?: boolean) => void,
): void {
  useEffect(() => {
    if (total === undefined) return;
    const last = lastPageOf(total, PAGE_SIZE);
    if (page > last) onPage(last, true);
  }, [page, total, onPage]);
}

export type TabProps = { page: number; onPage: (page: number, replace?: boolean) => void };
