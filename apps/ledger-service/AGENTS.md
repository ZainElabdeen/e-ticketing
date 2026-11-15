# Ledger Service

Shared Nest conventions: `packages/nest-common/AGENTS.md` (read it first).
Owns schema `ledger`. Spec §4.4; ADR-0009.

- **Append-only**: the runtime role `ledger_app` has no UPDATE/DELETE/TRUNCATE on
  journal tables. Corrections are new reversing entries.
- **Balance lives in the DB**: a deferred constraint trigger enforces at least
  two lines, debits = credits and currency match. Tests assert SQLSTATE
  `check_violation`, not a TS error.
- `UNIQUE(transaction_id)`: a replay with the same payload returns the stored
  entry; a different payload is a conflict.
- Accounts are seeded by migration: 1100 Payment Gateway Clearing, 2100 Customer
  Refunds Payable, 4000 Ticket Sales Revenue.
- **New posting type**: `domain/templates.ts`, the DTO `@IsIn`, the table CHECK
  (new SQL migration) and the OpenAPI contract.
