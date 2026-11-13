# ADR-0007: Money as integer minor units + currency column

## Context

Prices, payment amounts and ledger lines must add up exactly; a financial
audit trail cannot tolerate float rounding.

## Decision

All amounts are `bigint` **minor units** (fils; 1 AED = 100 fils) with an
explicit `currency char(3)` column on every row that carries an amount. API
payloads use integer `amountMinor` + `currency` fields; the SPA formats for
display. Gold = 10000, Premium = 20000, VIP = 50000.

## Alternatives

- **NUMERIC(12,2)**: exact in Postgres, but amounts leave the DB as strings or
  floats depending on driver; integer minor units are unambiguous end-to-end.
- **Floats**: never for money.
- **Money library (dinero.js)**: unnecessary dependency for add/multiply.

## Trade-off

Minor-unit conversion lives at the UI edge and in seeds, a classic source of
×100 bugs — mitigated by naming every field `*_minor`/`*Minor` and unit tests
on the totals. Single currency (AED) assumed throughout; the column exists so
the model does not need migration to say so.
