# ADR-0003: One PostgreSQL instance, one schema and two roles per service

## Context

Microservices need isolated data ownership; the challenge runs on free-tier
infrastructure where three managed databases are not realistic.

## Decision

A single PostgreSQL instance with three schemas — `tickets`, `payments`,
`ledger`. Each schema has an owner role (`*_owner`, runs migrations) and a
runtime role (`*_app`, DML on its own schema only). No cross-schema foreign
keys or queries; services integrate only over REST.
`payments.payments.order_id` and `tickets.orders.paid_transaction_id` are
logical references, not foreign keys.

## Alternatives

- **One database per service**: stricter isolation, same logical guarantees,
  three times the operational footprint on a free-tier VM.
- **Shared schema**: simplest, but removes the data-ownership separation the
  challenge asks for (tickets / orders-transactions / ledger).

## Trade-off

A noisy neighbor can affect all services, and only grants stop a future
cross-schema join. Accepted: grants plus review give practical isolation with
one instance to operate. Moving to a database per service later means a dump
and restore per schema and changing connection strings; no code change.
