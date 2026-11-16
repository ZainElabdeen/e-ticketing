import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import { PAGE_SIZE } from './usePage';

export const summaryKey = ['backoffice', 'summary'] as const;
export const accountsKey = ['backoffice', 'accounts'] as const;
export const availabilityKey = ['backoffice', 'ticket-availability'] as const;
export const transactionsKey = (page: number) => ['backoffice', 'transactions', page] as const;

export const ledgerKey = (page: number) => ['backoffice', 'ledger-entries', page] as const;

// Section tables: refetch on mount only once 10 s old, and every 15 s while the tab is visible
// (ledger entries arrive seconds after a payment through the outbox).
export const SECTION = {
  staleTime: 10_000,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
} as const;

// Summary tiles: one gateway call (`/v1/backoffice/summary`) for all three tiles. Nothing refetches
// on mount or focus; a 30 s interval keeps them current. TanStack evaluates staleTime and
// refetchOnMount per observer at the moment it mounts, and every observer that sets an interval
// runs its own timer, so the section tables (SECTION, 15 s) never change how often this runs.
export const SUMMARY = {
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

export function useSummary() {
  const api = useApi();
  return useQuery({
    ...SUMMARY,
    queryKey: summaryKey,
    queryFn: () => call(api.GET('/v1/backoffice/summary')),
  });
}

export function useAccounts() {
  const api = useApi();
  return useQuery({
    ...SECTION,
    queryKey: accountsKey,
    queryFn: () => call(api.GET('/v1/backoffice/accounts')),
  });
}

export function useAvailability() {
  const api = useApi();
  return useQuery({
    ...SECTION,
    queryKey: availabilityKey,
    queryFn: () => call(api.GET('/v1/backoffice/ticket-availability')),
  });
}

export function useTransactions(page: number) {
  const api = useApi();
  return useQuery({
    ...SECTION,
    placeholderData: keepPreviousData,
    queryKey: transactionsKey(page),
    queryFn: () =>
      call(
        api.GET('/v1/backoffice/transactions', {
          params: { query: { page, pageSize: PAGE_SIZE } },
        }),
      ),
  });
}

export function useLedgerEntries(page: number) {
  const api = useApi();
  return useQuery({
    ...SECTION,
    placeholderData: keepPreviousData,
    queryKey: ledgerKey(page),
    queryFn: () =>
      call(
        api.GET('/v1/backoffice/ledger-entries', {
          params: { query: { page, pageSize: PAGE_SIZE } },
        }),
      ),
  });
}
