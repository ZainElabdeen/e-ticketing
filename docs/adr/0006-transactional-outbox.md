# ADR-0006: Transactional outbox; confirm the order before posting to the ledger

## Context

A successful payment must produce a transaction record, a confirmed order
(Ticket Service) and a balanced ledger entry (Ledger Service). A crash between
steps must not lose work; a retry must not duplicate it; and the ledger is
append-only, so nothing posted can be taken back.

## Decision

- **Outbox**: the success DB transaction writes the payment update, the
  `transactions` row and an `outbox_events` row (`payment.succeeded`)
  together.
- **Claim**: the worker processes one event per DB transaction, selected with
  `FOR UPDATE SKIP LOCKED`. The row lock is the claim; a crashed worker's
  transaction aborts and the event becomes eligible again. No `PROCESSING`
  status, no lease timeout.
- **Order of calls — confirm first**:
  1. `POST /v1/internal/orders/{orderId}/confirm`. `200` → outcome
     `CONFIRMED`; `409 ORDER_NOT_CONFIRMABLE` → outcome `NOT_CONFIRMABLE`.
     The outcome is stored on the event and never asked again.
  2. `POST /v1/internal/postings` with posting type `TICKET_SALE` (confirmed)
     or `UNFULFILLED_PAYMENT` (not confirmable). The ledger chooses accounts.
- **Retries**: transient errors back off `min(2^attempts, 300)` s; after 10
  attempts (the gaps sum to 810 s, about 13.5 min) the event is `FAILED` and logged; a runbook SQL resets it.
- Both receivers are idempotent (order status + transaction ID; ledger
  `UNIQUE(transaction_id)`), so at-least-once delivery is safe.

## Alternatives

- **Ledger first, then confirm**: revenue would be recorded before we know the
  order can be fulfilled, and an append-only ledger cannot undo it.
- **Synchronous calls inside the payment request**: a ledger outage would fail
  payments, and a crash after commit would still lose the calls.
- **Message broker (RabbitMQ/Kafka)**: the usual transport for this pattern,
  but a whole extra service for one event type; outbox + poller gives the same
  at-least-once guarantee.
- **CDC (Debezium)**: far too heavy here.

## Trade-off

Up to ~2 s between payment success and confirmation/ledger visibility, and a
worker DB transaction stays open across two HTTP calls (5 s timeout each).
Accepted at this volume. The SPA shows success from the payment itself, not
from the outbox.

## Amended 2026-11-14

Ledger outages must not stall confirmations, because an unconfirmed order
expires after 15 minutes. Within one worker run, the first failed Ledger call
trips a breaker: later events in that batch still confirm the order, but are
retried with `last_error = 'ledger skipped: unavailable earlier in this batch'`
without calling the Ledger. A skipped event counts as an attempt. The breaker
is a local variable of the run, so it resets on the next tick. Every downstream
call also has a hard total timeout (`AbortSignal.timeout`), since axios
`timeout` is only an idle timeout. If processing throws after the claim, the
repository records the attempt in a separate statement so the event cannot
loop forever below `FAILED`.
