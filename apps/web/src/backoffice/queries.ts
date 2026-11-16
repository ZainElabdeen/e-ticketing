import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import { PAGE_SIZE } from './usePage';

export const REVENUE_ACCOUNT_CODE = '4000';

export const accountsKey = ['backoffice', 'accounts'] as const;
export const availabilityKey = ['backoffice', 'ticket-availability'] as const;
export const transactionsKey = (page: number) => ['backoffice', 'transactions', page] as const;

export const ledgerKey = (page: number) => ['backoffice', 'ledger-entries', page] as const;

// Fresh data: refetch on every mount and every 15 s while the tab is visible (ledger entries
// arrive seconds after a payment through the outbox).
const FRESH = {
  refetchOnMount: 'always',
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
} as const;

export function useAccounts() {
  const api = useApi();
  return useQuery({
    ...FRESH,
    queryKey: accountsKey,
    queryFn: () => call(api.GET('/v1/backoffice/accounts')),
  });
}

export function useAvailability() {
  const api = useApi();
  return useQuery({
    ...FRESH,
    queryKey: availabilityKey,
    queryFn: () => call(api.GET('/v1/backoffice/ticket-availability')),
  });
}

export function useTransactions(page: number) {
  const api = useApi();
  return useQuery({
    ...FRESH,
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
    ...FRESH,
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
