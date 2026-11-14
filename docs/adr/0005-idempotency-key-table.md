# ADR-0005: Payment idempotency via key table, bound on payment creation

## Context

`POST /v1/payments` must be safe to retry (timeouts, double clicks) without
creating a second payment. Two other questions need exact answers for the
contract suite: what happens to a key whose request failed, and what a
concurrent duplicate sees.

## Decision

- `Idempotency-Key` header required (400 if absent). Table
  `idempotency_keys(key PK, request_hash, payment_id, response_status, response_body)`.
- **Request hash**: SHA-256 of the canonical JSON (sorted keys) of the
  validated DTO, with PAN and CVC replaced by the last four digits. The full
  PAN never enters the hash.
- **Bind on create**: the key row is inserted in the same DB transaction as
  the payment and committed only if a payment row was created. Every earlier
  failure (400, 404, 409, 422 `INVALID_CARD`) rolls back, leaving the key free
  for a corrected retry.
- **Concurrency**: `INSERT … ON CONFLICT (key) DO NOTHING` blocks while
  another transaction holds the same key uncommitted. When it returns, the
  winner has either committed (replay its response) or rolled back (we now
  own the key). No polling, no "in progress" status.
- **Replay**: same key + same hash → the stored status (201) and body,
  verbatim, plus header `Idempotent-Replayed: true`. Same key + different
  hash → `422 IDEMPOTENCY_KEY_REUSE`.
- **Stale replay**: a QR replay returns the original `PENDING` body even after
  success. Intended: the key describes the create call; live state comes from
  `GET /v1/payments/{paymentId}`.
- **Not the duplicate-payment guard**: keys dedupe retries of one request.
  One live payment per order is a separate business rule, enforced by a
  partial unique index on `payments(order_id)`.

## Alternatives

- **Store failed responses too**: a user who fixes a mistyped card under the
  same key would be stuck on `IDEMPOTENCY_KEY_REUSE` forever.
- **Unique (order_id, method) instead of keys**: mixes business rules with
  retry semantics and answers retries with 409 instead of the original
  response.
- **In-memory or Redis key store**: extra infrastructure, and responses must
  survive restarts.

## Trade-off

Keys are kept forever in challenge scope; real systems expire them after
about 24 h. A concurrent duplicate holds a DB connection while it waits for
the winner (milliseconds for card; QR creation does no waiting).

## Amended 2026-11-14

The lock-free key pre-read runs before the order read and before the
handler's card checks, so a stored response always wins. Reason: a legitimate
retry of a successful payment must replay even after the order was confirmed
(no `409`) or the card's expiry month has passed (no `422`); the request hash
proves the body is identical. The insert inside the transaction is still the
arbiter for concurrent duplicates.
