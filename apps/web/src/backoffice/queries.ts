import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import { PAGE_SIZE } from './usePage';

export const REVENUE_ACCOUNT_CODE = '4000';

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

// Summary tiles: cheaper. They never refetch on mount or focus; a 30 s interval keeps them current.
// They share query keys with the section tables, so while a table is mounted TanStack applies the
// shortest interval and the lowest staleTime across the key's observers (the table's 15 s wins).
export const TILE = {
  staleTime: 30_000,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
} as const;

type Freshness = typeof SECTION | typeof TILE;

export function useAccounts(freshness: Freshness = SECTION) {
  const api = useApi();
  return useQuery({
    ...freshness,
    queryKey: accountsKey,
    queryFn: () => call(api.GET('/v1/backoffice/accounts')),
  });
}

export function useAvailability(freshness: Freshness = SECTION) {
  const api = useApi();
  return useQuery({
    ...freshness,
    queryKey: availabilityKey,
    queryFn: () => call(api.GET('/v1/backoffice/ticket-availability')),
  });
}

export function useTransactions(page: number, freshness: Freshness = SECTION) {
  const api = useApi();
  return useQuery({
    ...freshness,
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

export function useLedgerEntries(page: number, freshness: Freshness = SECTION) {
  const api = useApi();
  return useQuery({
    ...freshness,
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
