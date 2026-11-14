# ADR-0021: ASP.NET Core Ticket Service port

## Context

ADR-0002 commits to porting the Ticket Service to ASP.NET Core against the
same OpenAPI contract, gated by the same black-box contract suite. The `tickets`
schema is owned by Prisma raw-SQL migrations (ADR-0015) and the behaviour is
fixed by spec sections 4.1 and 4.5, so the port must change nothing a client or
the database can see.

## Decision

- **One web project, folders by layer** (`Config`, `Http`, `Domain`,
  `Application`, `Infrastructure`, `Controllers`, `Contracts`), with tests in a
  separate project. Controllers, not Minimal APIs.
- **EF Core maps the Prisma-owned schema and runs no migrations.** No
  `Migrate()`, no `EnsureCreated()`, no EF migration files.
- **Raw SQL for the locking statements** (conditional reservation UPDATE,
  `FOR UPDATE`, `SKIP LOCKED`), through EF's interpolated, parameterized
  `SqlQuery` / `ExecuteSqlAsync`, inside explicit transactions.
- **A middleware pipeline replicates the NestJS envelope and key scopes**:
  correlation ID, API key with `[InternalScope]` metadata plus a normalized path
  check, error envelope (never ProblemDetails), strict System.Text.Json binding.
- **Serilog compact JSON** to stdout with the spec section 7 fields.
- **`/docs` serves the contract file** (`packages/contracts/dist/ticket-service.json`,
  copied at build), so docs and the contract cannot drift.
- **Compose runs the .NET image as `ticket-service`.** The NestJS service stays
  as the reference under the `reference` profile on host port 3011.
- **The contract suite is the parity gate.** Both implementations must pass the
  identical suite (38/38 for the ticket suite) before the switch.
- The Docker image bundles the contract in an early Node stage, so a clean
  checkout builds with `docker compose up --build`, and sets no RID so it builds
  for `linux/arm64` too.

## Alternatives

- **Minimal APIs**: less ceremony, but endpoint metadata (`[InternalScope]`),
  filters and validation are more explicit with controllers, and the layout
  mirrors the NestJS controllers.
- **Four assemblies** (Domain, Application, Infrastructure, Api): adds
  ceremony and no isolation for a service this size; review enforces the
  dependency rule.
- **EF migrations**: would create a second schema history next to Prisma's.
- **Dapper**: fine for the locking SQL, but a second data-access technology;
  EF's parameterized raw SQL covers it.

## Trade-off

Ticket logic exists twice (NestJS reference and .NET), and the reference needs
upkeep only as long as it serves as the parity oracle. In return, the contract
suite proves the two behave identically and the mandated .NET service is the
one deployed.
