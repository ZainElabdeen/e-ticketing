# Payment Service

Shared Nest conventions: `packages/nest-common/AGENTS.md` (read it first).
Owns schema `payments`. Spec §4.2–4.4; ADR-0005, 0006, 0008, 0010.

- **Payment methods**: Strategy + registry. Follow the `add-payment-method`
  skill. `HandlerRegistry` throws at startup on a duplicate or missing handler.
- **Idempotency**: claim by insert (`ON CONFLICT DO NOTHING`) in the same
  transaction as the payment, transaction row, outbox event and stored response.
  A replay returns the stored response with `Idempotent-Replayed: true`. The
  request hash covers `orderId`, `method` and card `last4`/expiry/holder, never
  the PAN (spec §4.2).
- **PCI**: only `card_last4` is persisted. Logs redact `req.body.card.*`. DTO and
  handler messages never echo card values.
- **Outbox**: the event type is CHECK-limited to `payment.succeeded`. The confirm
  outcome (`CONFIRMED` / `NOT_CONFIRMABLE`) chooses the ledger posting type
  (`TICKET_SALE` / `UNFULFILLED_PAYMENT`). Known crash-window risk: ADR-0006
  amendment.
- **Clock**: QR success timing reads the `CLOCK` provider
  (`common/clock.ts`); tests pass a fake through `AppOptions.clock`.
