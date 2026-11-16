import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { ApiError, call, messageFor } from '../api/errors';
import type { TicketType } from '../api/types';
import { maxFor } from './maxFor';
import { TICKET_TYPES_KEY } from './useTicketTypes';

export type OrderLine = TicketType & { quantity: number };

function orderMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'QUOTA_EXCEEDED')
    return 'Not enough tickets left';
  return messageFor(error);
}

/** Creates the order for the selected lines; on a quota race it refetches and clamps them. */
export function useOrderCheckout(
  lines: OrderLine[],
  total: number,
  setSelected: Dispatch<SetStateAction<Record<string, number>>>,
) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const order = useMutation({
    mutationFn: async () => {
      const items = lines
        .filter((l) => l.quantity > 0)
        .map((l) => ({ ticketTypeCode: l.code, quantity: l.quantity }));
      return call(api.POST('/v1/orders', { body: { items } }));
    },
    onSuccess: (created) => {
      void navigate(`/checkout/${created.id}`);
    },
    onError: async (e) => {
      // Released on failure only: on success the page stays locked until navigation unmounts it.
      inFlight.current = false;
      setError(orderMessage(e));
      if (e instanceof ApiError && e.code === 'QUOTA_EXCEEDED') {
        await queryClient.refetchQueries({ queryKey: TICKET_TYPES_KEY });
        const fresh = queryClient.getQueryData<TicketType[]>(TICKET_TYPES_KEY);
        if (fresh) {
          // Write the clamp back so a later availability increase does not restore the old quantity.
          setSelected((s) =>
            Object.fromEntries(fresh.map((t) => [t.code, Math.min(s[t.code] ?? 0, maxFor(t))])),
          );
        }
      }
    },
  });

  const checkout = (): void => {
    if (inFlight.current || total === 0) return;
    inFlight.current = true;
    setError(null);
    order.mutate();
  };

  return { checkout, error, locked: order.isPending || order.isSuccess };
}
