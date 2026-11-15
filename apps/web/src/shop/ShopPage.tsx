import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import type { TicketType } from '../api/types';
import { formatMinor, sumMinor } from '../lib/money';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Stepper } from '../ui/Stepper';
import { TicketStub } from '../ui/TicketStub';
import styles from './ShopPage.module.css';
import { TICKET_TYPES_KEY, useTicketTypes } from './useTicketTypes';

const MAX_PER_TYPE = 10;
const GENERIC = 'Something went wrong on our side. Try again.';

const maxFor = (t: TicketType): number => Math.min(MAX_PER_TYPE, Math.max(0, t.available));

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'QUOTA_EXCEEDED') return 'Not enough tickets left';
    if (error.code === 'RATE_LIMITED') return 'Too many requests, try again shortly';
  }
  return GENERIC;
}

export function ShopPage(): ReactElement {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const types = useTicketTypes();
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const list = types.data ?? [];
  // Clamp at read time so a refetch with lower availability never leaves an over-max quantity.
  const quantityOf = (t: TicketType): number => Math.min(selected[t.code] ?? 0, maxFor(t));
  const lines = list.map((t) => ({ ...t, quantity: quantityOf(t) }));
  const total = sumMinor(lines);
  const currency = list[0]?.currency ?? 'AED';

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
      setError(messageFor(e));
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

  return (
    <section>
      <h1 className={styles.title}>Pick your tickets</h1>
      {error ? <Banner>{error}</Banner> : null}
      {types.isPending ? <p className={styles.quiet}>Loading tickets…</p> : null}
      {types.isError ? (
        <div>
          <Banner>{GENERIC}</Banner>
          <Button variant="quiet" onClick={() => void types.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {list.length > 0 ? (
        <>
          <div className={styles.list}>
            {lines.map((t) => (
              <TicketStub
                key={t.code}
                tier={t.code}
                stub={
                  <Stepper
                    label={t.name}
                    value={t.quantity}
                    min={0}
                    max={maxFor(t)}
                    onChange={(n) => setSelected((s) => ({ ...s, [t.code]: n }))}
                  />
                }
              >
                <h2 className={styles.name}>{t.name}</h2>
                <p className={styles.price}>{formatMinor(t.priceMinor, t.currency)}</p>
                <p className={styles.left}>
                  {t.available > 0 ? `${t.available} left` : 'Sold out'}
                </p>
              </TicketStub>
            ))}
          </div>
          <div className={styles.footer}>
            <p className={styles.total}>
              Total <strong>{formatMinor(total, currency)}</strong>
            </p>
            <Button disabled={total === 0 || order.isPending || order.isSuccess} onClick={checkout}>
              Checkout
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
