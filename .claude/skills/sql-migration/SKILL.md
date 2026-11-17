---
name: sql-migration
description: Use when changing a database table, column, constraint, index, grant or seed row in the tickets, payments or ledger schema. Hand-written SQL migrations, Prisma schema sync and the .NET mapping.
---

# SQL migration

Migrations are hand-written SQL applied by `prisma migrate deploy` (ADR-0015).
Never run `prisma migrate dev` or `prisma db push`.

## Steps

1. **Pick the owner app.** `tickets` → `apps/ticket-service-dotnet`, `payments` →
   `apps/payment-service`, `ledger` → `apps/ledger-service`. No cross-schema
   foreign keys (ADR-0003).
2. **Write the failing test first** in that app's `test/schema.int-spec.ts`
   (constraints, indexes, grants) or the behaviour spec that needs the change.
   For `tickets` it is `SchemaConstraintsTests.cs` in the .NET integration tests.
3. **Add a new directory** `apps/<app>/prisma/migrations/<YYYYMMDDHHMMSS>_<snake_name>/migration.sql`.
   Never edit an applied migration.
4. **Write the SQL** with schema-qualified names. Checklist:
   - CHECK constraints for every invariant (`amount > 0`,
     `sold + reserved <= quota`, enum-like text columns).
   - Indexes on status, `created_at`, foreign keys and lookup columns.
   - Money as `bigint` minor units plus a `currency` column (ADR-0007).
   - Grants for the runtime role `<schema>_app`. Default privileges cover
     tables only: grant sequences explicitly. In `ledger`, keep journal tables
     append-only (no UPDATE/DELETE/TRUNCATE for `ledger_app`).
5. **Sync `prisma/schema.prisma`** so `test/prisma-drift.int-spec.ts` passes, then
   `pnpm --filter @eticket/<app> generate`. Not for `tickets`: its
   `schema.prisma` has no models and there is no `generate`.
6. **`tickets` schema only**: update the EF mapping in
   `apps/ticket-service-dotnet/src/TicketService.Api/Infrastructure/` and
   `SchemaMappingTests`, then run the .NET integration tests.
7. **Second migration in a schema**: `infra/scripts/verify-db.sh` asserts exactly
   one recorded migration per schema; update that check in the same change.
8. **If the API shape changes**, run the `contract-change` skill too.

## Done when

- `pnpm --filter @eticket/<app> test:int` passes (applies all migrations to a
  fresh Testcontainers DB, including the drift test; for `tickets` use the .NET app).
- For `tickets`: `pnpm --filter @eticket/ticket-service-dotnet test:int` passes.
- With the stack rebuilt (`docker compose -f infra/docker-compose.yml up -d --build`),
  `infra/scripts/verify-db.sh` prints `DB OK`.
