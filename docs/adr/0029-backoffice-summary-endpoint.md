# ADR-0029: Backoffice summary endpoint in the gateway (BFF aggregation)

Builds on ADR-0012 (gateway as BFF) and ADR-0028.

## Context

The backoffice summary tiles (revenue, transaction total, tickets left) each
called a different backoffice route: accounts, transactions and ticket
availability. Every refresh was three browser requests, each carrying a JWT
check and counting against the rate limit, only to read three numbers.

## Decision

Add `GET /v1/backoffice/summary` to the gateway (contract `BackofficeSummary`,
`gateway.yaml` 2.2.0, additive). A small injectable `BackofficeSummaryService`
calls ledger `GET /v1/accounts`, payment `GET /v1/transactions?page=1&pageSize=1`
(only `total`) and ticket `GET /v1/ticket-types` in parallel with the request's
correlation ID, and returns revenue (account 4000 balance, 0 when absent),
transaction count and the sums of available and quota. Any downstream failure
(transport error, timeout, non-2xx, unexpected body) fails the whole request
as 502 `UPSTREAM_UNAVAILABLE` or 504 `UPSTREAM_TIMEOUT`; no new codes. It uses
the default rate limit like the other backoffice routes. The SPA reads it with
one query (30 s interval, no refetch on mount or focus).

## Alternatives

- **Client-side fan-out (before)**: three requests per refresh and the SPA knows
  each downstream shape.
- **Per-service summary endpoints**: more contract and service surface (and the
  .NET port) for three numbers.
- **Caching layer in the gateway**: a new moving part and stale data; the
  30 s client interval already bounds load.

## Trade-off

The gateway holds a little read-model logic (account code 4000, sums) and the
tiles fail together: one slow or broken service blanks all three. In return a
refresh costs one browser request and the SPA depends on one stable shape.
