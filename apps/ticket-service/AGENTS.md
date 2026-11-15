# Ticket Service (NestJS reference implementation)

Shared Nest conventions: `packages/nest-common/AGENTS.md` (read it first).
Owns schema `tickets`. Spec §4.1; ADR-0004, 0021.

- **Two implementations, one contract.** `apps/ticket-service-dotnet` (the image
  compose runs) mirrors this service. A behaviour change lands in both and both
  pass `infra/scripts/contract.sh ticket` (reference on `127.0.0.1:3011`).
- **Schema owner for both.** The SQL migrations here define the `tickets` schema
  for the .NET port too; a table change also updates the .NET entity mapping
  (`SchemaMappingTests`).
- **Lock order**: the order row first, then ticket types ascending by code.
  Reuse `sortLines` for any multi-type SQL. Reservation is one conditional
  `UPDATE ... WHERE sold + reserved + qty <= quota`.
- `decideConfirmation` (domain) decides; the SQL branches live in
  `orders.repository.ts`.
- `GET /v1/ticket-types` is the public availability route
  (`ticket-type.view.ts`).
