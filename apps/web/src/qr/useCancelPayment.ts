import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import { forgetPayment } from '../payment/paymentMemory';
import { paymentKey } from '../payment/paymentKey';

/** Cancels a QR payment and sends the visitor back to the card form. */
export function useCancelPayment(orderId: string, paymentId: string) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // A ref, not isPending: two clicks can land before React re-renders the disabled button.
  const cancelling = useRef(false);
  const cancel = useMutation({
    mutationFn: () =>
      call(api.POST('/v1/payments/{paymentId}/cancel', { params: { path: { paymentId } } })),
    onSuccess: () => {
      forgetPayment(orderId);
      void navigate(`/checkout/${orderId}?method=card`, { replace: true });
    },
    onError: async (e) => {
      // Released on failure only: on success the page stays locked until navigation unmounts it.
      cancelling.current = false;
      if (e instanceof ApiError && e.code === 'PAYMENT_NOT_CANCELLABLE') {
        // Raced with the server: whatever the payment is now decides where we go.
        await queryClient.invalidateQueries({ queryKey: paymentKey(paymentId) });
      }
    },
  });

  const conflict =
    cancel.error instanceof ApiError && cancel.error.code === 'PAYMENT_NOT_CANCELLABLE';
  const run = (): void => {
    if (cancelling.current) return;
    cancelling.current = true;
    cancel.mutate();
  };

  return {
    run,
    isPending: cancel.isPending,
    conflict,
    failed: cancel.isError && !conflict,
    error: cancel.error,
  };
}
