---
name: add-payment-method
description: Use when adding a payment method (wallet, bank transfer, crypto, etc.) or changing how an existing method validates or initiates. Strategy + registry in the Payment Service.
---

# Add a payment method

Strategy + registry (ADR-0008). A new method is one handler class plus the
places that enumerate methods. The amount always comes from the Ticket
Service, never the client.

## Steps

1. **Contract first**: add the method to the `method` enum and its request
   fields in `payment-service.yaml` and `gateway.yaml` (follow the
   `contract-change` skill).
2. **Failing unit test** in
   `apps/payment-service/src/payments/handlers/handlers.spec.ts` (validation
   errors, initiate result: immediate success or PENDING).
3. **Handler class** `<name>.handler.ts` implementing `PaymentHandler`
   (`method`, `validate`, `initiate`) next to `card.handler.ts` / `qr.handler.ts`.
4. **Register it** in the `PAYMENT_HANDLERS` factory array in
   `apps/payment-service/src/app.module.ts`. `HandlerRegistry` throws at startup
   on a duplicate or missing method.
5. **Widen the enumerations**:
   - `PaymentMethod` in `payments/domain/types.ts`;
   - DTO `@IsIn` and the `CardMatchesMethod` rule;
   - the DB CHECK on `payments.payments.method` (new migration via the
     `sql-migration` skill);
   - the request hash in `payments/domain/request-hash.ts` if the method adds
     body fields. Hash only non-sensitive fields.
6. **Sensitive data**: store nothing a PCI or privacy reviewer would object to;
   add new secret body fields to the pino redact list.
7. **Web**: add the option to `apps/web/src/checkout/` with its own schema and
   tests.

## Done when

- `pnpm --filter @eticket/payment-service test` and `test:int` pass, including
  idempotency replay and a 422 for the same key with a different body.
- The payment and gateway contract suites pass (`infra/scripts/contract.sh`).
- Spec §4.2 lists the method.
