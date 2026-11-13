# ADR-0009: Double-entry, append-only ledger with ledger-owned posting templates

## Context

The challenge asks for double-entry ledger entries and a clear financial audit
trail. The outbox delivers at least once. The Payment Service should not know
the chart of accounts.

## Decision

- **Semantic posting API**: producers call `POST /v1/internal/postings` with a
  posting type and the business facts (transaction ID, order, reference,
  amount, currency). The Ledger owns the templates:
  - `TICKET_SALE`: Debit `1100 Payment Gateway Clearing` / Credit
    `4000 Ticket Sales Revenue`.
  - `UNFULFILLED_PAYMENT`: Debit `1100` / Credit `2100 Customer Refunds
    Payable` — cash was received but the order could not be fulfilled, so no
    revenue is recognized.
- **Balanced**: per entry Σdebits = Σcredits, checked in the application
  before insert and by a deferred constraint trigger. One currency per entry,
  equal to every line's account currency.
- **Append-only**: the runtime role has `SELECT, INSERT` only on journal
  tables. A correction is a new reversing entry; no current flow needs one.
- **Idempotent per transaction, not per payment**: `UNIQUE(transaction_id)`
  dedupes *deliveries* of one transaction's event. Preventing two payments for
  one order is the Payment Service's job (partial unique index). A re-post with
  the same type and amount returns the existing entry (200); with different
  values, `409 POSTING_CONFLICT`.
- **Balances derived**: debit-normal (ASSET, EXPENSE) = Σdebit − Σcredit;
  credit-normal (LIABILITY, EQUITY, REVENUE) = Σcredit − Σdebit.

## Alternatives

- **Producer sends the lines**: a generic ledger API, but every producer must
  know account codes, and changing the chart of accounts breaks producers.
- **Single-entry transaction log**: records payments but cannot show the
  ledger is balanced.
- **Balance columns updated in place**: loses history; balances are a `SUM`
  over indexed lines.
- **Trigger-only balance check**: the database check is the backstop; the
  application check gives a clear 422 instead of a constraint error.

## Trade-off

The ledger API is specific to this business (two posting types), so a new
flow needs a ledger change. Accepted: that is where accounting knowledge
belongs. Aggregated balances are slower than stored ones, irrelevant at this
volume.
