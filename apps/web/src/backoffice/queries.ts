import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import { PAGE_SIZE } from './usePage';

export const REVENUE_ACCOUNT_CODE = '4000';

export const accountsKey = ['backoffice', 'accounts'] as const;
export const availabilityKey = ['backoffice', 'ticket-availability'] as const;
export const transactionsKey = (page: number) => ['backoffice', 'transactions', page] as const;

export function useAccounts() {
  const api = useApi();
  return useQuery({
    queryKey: accountsKey,
    queryFn: () => call(api.GET('/v1/backoffice/accounts')),
  });
}

export function useAvailability() {
  const api = useApi();
  return useQuery({
    queryKey: availabilityKey,
    queryFn: () => call(api.GET('/v1/backoffice/ticket-availability')),
  });
}

export function useTransactions(page: number) {
  const api = useApi();
  return useQuery({
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
