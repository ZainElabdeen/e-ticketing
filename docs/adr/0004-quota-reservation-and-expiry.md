# ADR-0004: Quota reservation via atomic conditional UPDATE; 15-minute expiry

## Context

100 tickets per type must never oversell under concurrent checkouts,
abandoned checkouts must release their hold, and three writers touch the same
counters: order creation, the expiry job and order confirmation.

## Decision

- **Reserve**: one conditional UPDATE per item inside one transaction:
  `SET reserved = reserved + $qty WHERE code = $code AND sold + reserved + $qty <= quota`.
  Zero rows → roll back → `409 QUOTA_EXCEEDED`. The row lock serializes
  buyers of one type; the `CHECK (sold + reserved <= quota)` constraint is the
  backstop.
- **Lock order**: every writer locks the order row first (when one exists),
  then `ticket_types` rows sorted by `code`. Sorting items prevents deadlocks
  between multi-item orders (GOLD+VIP vs VIP+GOLD).
- **Expire**: orders are `PENDING` with `expires_at = now() + 15 min`. A job
  every 60 s takes one order at a time with `FOR UPDATE SKIP LOCKED`, marks it
  `EXPIRED` and releases `reserved`.
- **Confirm**: takes a *blocking* `FOR UPDATE` on the order row and branches
  on the status it sees under the lock. Because confirm blocks and the expiry
  job skips locked rows, the two can never both act on one order. `PENDING`
  moves `reserved` to `sold`. `CONFIRMED` with the same transaction ID is an
  idempotent `200`.
- **Expired-but-paid policy**: a paid order is honored if quota still allows.
  Confirming an `EXPIRED` order re-runs the same guard
  (`sold + reserved + qty <= quota`) and on success increments `sold` directly
  (its reservation was already released). All items or none; otherwise
  `409 ORDER_NOT_CONFIRMABLE`, and the payment becomes a refund liability in
  the ledger (ADR-0006, ADR-0009).

## Alternatives

- **SELECT … FOR UPDATE then UPDATE** for reservation: equally correct, two
  round trips; the conditional UPDATE puts the guard and the write in one
  statement.
- **Serializable isolation**: correct, but needs a retry loop for one counter.
- **Check quota only at confirm**: users would pay for tickets that are gone.
- **Refuse late payments outright**: the customer already paid; honoring when
  possible is the better outcome.

## Trade-off

The expired-but-paid window is not negligible: it opens when the payment
lands near expiry or when the Ticket Service is down long enough for outbox
retries (up to ~19 min) to cross the 15-minute mark. The policy above handles
it deterministically. `reserved` can lag reality by one job interval; the
invariant `sold + reserved <= quota` holds at all times.
