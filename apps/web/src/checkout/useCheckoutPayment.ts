import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Api } from '../api/client';
import { ApiError, GENERIC_MESSAGE, messageFor } from '../api/errors';
import type { CardDetails, Order } from '../api/types';
import type { Method } from './MethodPicker';
import { newIdempotencyKey, submitPayment } from './pay';
import { recallPayment, rememberPayment } from './paymentMemory';

export type BannerState = { tone: 'error' | 'info'; text: string };

export interface CheckoutPayment {
  busy: boolean;
  banner: BannerState | null;
  setBanner: (b: BannerState | null) => void;
  notPayable: boolean;
  paid: boolean;
  recalled: boolean;
  newKey: () => void;
  pay: (method: Method, card?: CardDetails, setNumberError?: (m: string) => void) => Promise<void>;
}

export function useCheckoutPayment(props: {
  api: Api;
  order: Order;
  setOtherWindow: (v: boolean) => void;
}): CheckoutPayment {
  const { api, order, setOtherWindow } = props;
  const orderId = order.id;
  const navigate = useNavigate();
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [notPayable, setNotPayable] = useState(false);
  const [paidElsewhere, setPaidElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  // null = the next submit makes a fresh key (lazily, no randomUUID per render).
  const key = useRef<string | null>(null);

  const newKey = useCallback(() => {
    key.current = null;
  }, []);

  const paid = order.status === 'CONFIRMED' || paidElsewhere;
  const recalled = paid ? recallPayment(orderId) : null;
  const recalledId = recalled?.paymentId;
  useEffect(() => {
    if (recalledId) void navigate(`/result/${recalledId}`, { replace: true });
  }, [recalledId, navigate]);

  const goToResultOrPaid = (): void => {
    const known = recallPayment(orderId);
    if (known) void navigate(`/result/${known.paymentId}`, { replace: true });
    else setPaidElsewhere(true);
  };

  // Maps a failed submit to the spec §5 table: sets banner or page state, or navigates.
  const handleError = (e: unknown, setNumberError?: (m: string) => void): void => {
    if (!(e instanceof ApiError)) {
      setBanner({ tone: 'error', text: GENERIC_MESSAGE });
      return;
    }
    switch (e.code) {
      case 'INVALID_CARD':
        setNumberError?.('Check the card number and expiry date');
        return;
      case 'ORDER_NOT_PAYABLE':
        setNotPayable(true);
        return;
      case 'PAYMENT_IN_PROGRESS': {
        const known = recallPayment(orderId);
        if (known?.method === 'QR') {
          void navigate(`/checkout/${orderId}/qr/${known.paymentId}`);
          return;
        }
        setBanner({
          tone: 'info',
          text: 'A payment for this order is already running in another window',
        });
        setOtherWindow(true);
        return;
      }
      case 'ORDER_ALREADY_PAID':
        goToResultOrPaid();
        return;
      default:
        setBanner({ tone: 'error', text: messageFor(e) });
    }
  };

  const pay = async (
    method: Method,
    card?: CardDetails,
    setNumberError?: (m: string) => void,
  ): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setBanner(null);
    try {
      const body = card
        ? ({ orderId, method: 'CARD', card } as const)
        : ({ orderId, method: 'QR' } as const);
      key.current ??= newIdempotencyKey();
      const sent = key.current;
      const result = await submitPayment(api, body, sent, {
        // Only while the form still holds the body this key was made for: an edit during the
        // request clears the key, and a reuse key must not bind to the edited body.
        onKey: (k) => {
          if (key.current === sent) key.current = k;
        },
      });
      key.current = result.key;
      rememberPayment(orderId, { paymentId: result.payment.id, method });
      void navigate(
        method === 'CARD'
          ? `/result/${result.payment.id}`
          : `/checkout/${orderId}/qr/${result.payment.id}`,
      );
    } catch (e) {
      inFlight.current = false;
      setBusy(false);
      handleError(e, setNumberError);
    }
    // On success the page stays locked until the navigation unmounts it, so a second click
    // during the route change cannot send another payment.
  };

  return { busy, banner, setBanner, notPayable, paid, recalled: recalled !== null, newKey, pay };
}
