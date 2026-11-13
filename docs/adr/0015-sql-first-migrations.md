# ADR-0015: SQL-first migrations, applied with `prisma migrate deploy`

## Context

The `tickets`, `payments` and `ledger` schemas need things Prisma's schema
language cannot express: `CHECK (sold + reserved <= quota)`, a partial unique
index (`one live payment per order`), deferred constraint triggers (a journal
entry with zero lines must still be rejected at COMMIT) and per-role grants
(append-only journal tables for `ledger_app`). The Ticket Service will later be
ported to .NET and must map exactly the same tables, so the schema history has
to be plain SQL that any tool can read.

Prisma's own answer — write the schema in `schema.prisma`, generate a migration,
then hand-edit it — is fragile: hand-added SQL is invisible to the schema
language, so the next `prisma migrate dev` computes the diff from the schema and
can silently drop it (prisma/prisma#24180). That is unacceptable for an
append-only ledger and for constraints that *are* the correctness argument.

## Decision

- Hand-written `migration.sql` is the single source of truth for the schema.
  Each service keeps its own history in `apps/<service>/prisma/migrations/`.
- Migrations are applied **only** with `prisma migrate deploy`, always as the
  schema's owner role (`MIGRATION_DATABASE_URL`). `prisma migrate dev` is never
  run, by anyone, in any environment.
- `prisma/schema.prisma` carries no models in Phase 1. Phase 2 adds them with
  `prisma db pull` so the TypeScript client is generated from the real tables;
  the file stays derived, never authoritative.
- The .NET port of the Ticket Service maps the existing tables with EF Core and
  runs no migrations, so there is one schema history rather than two.
- Re-running `migrate deploy` is a no-op: Prisma records each folder in
  `_prisma_migrations` and skips applied ones, which is what makes the compose
  migrate containers and the K3s bootstrap Job safe to repeat.

## Alternatives

- **Prisma schema-first with `--create-only` edits**: gives generated DDL and
  drift detection, but the hand-added parts live outside the schema language,
  so a future `migrate dev` may delete them, and `CHECK`/trigger support is
  absent by design.
- **A plain SQL runner such as dbmate or Flyway**: honest and simple, but a new
  tool, a new migration table and a new concept for every reviewer; Prisma is
  already in the stack for the client and its `deploy` mode only tracks and
  applies SQL files.
- **Prisma with `db execute` per file**: no ordering, no record of what ran.

## Trade-off

Every schema change is a hand-written `ALTER` written against PostgreSQL, with
no schema language to lean on: more typing, and a typo is found by
`pnpm test:int` rather than by a generator. In exchange the schema is exactly
what the spec says — constraints, partial indexes, triggers and grants — and
both the NestJS and the .NET Ticket Service read one migration history.
