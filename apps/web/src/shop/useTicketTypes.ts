import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApi } from '../api/client';
import { call } from '../api/errors';
import type { TicketType } from '../api/types';

export const TICKET_TYPES_KEY = ['ticket-types'] as const;

export function useTicketTypes(): UseQueryResult<TicketType[]> {
  const api = useApi();
  return useQuery({
    queryKey: TICKET_TYPES_KEY,
    queryFn: async () => (await call(api.GET('/v1/ticket-types'))).data,
  });
}
