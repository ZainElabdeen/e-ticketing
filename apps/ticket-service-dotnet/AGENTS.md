# Ticket Service (.NET port)

ASP.NET Core port of `apps/ticket-service`; the image compose runs as
`ticket-service`. ADR-0021. It passes the SAME contract suite as the NestJS
reference: a behaviour change lands in both.

- **Build needs the contract**: `TicketService.Api.csproj` fails unless
  `packages/contracts/dist/ticket-service.json` exists. Run
  `pnpm --filter @eticket/contracts build` first. The Dockerfile bundles it itself.
- **Schema is owned by the NestJS SQL migrations** (ADR-0015). There are no EF
  migrations; `Infrastructure/TicketsDbContext.cs` is a hand-mapped, untracked
  read model and `SchemaMappingTests` guards column drift.
- **Writes are raw SQL** (`SqlQuery` / `ExecuteSqlAsync` interpolated strings,
  parameterized by EF). Keep the single conditional UPDATE and the ascending
  code lock order (`Pricing.SortLines`).
- **Test categories**: every test class has
  `[Trait("Category", "Unit" | "Integration")]`; an untagged test runs in neither
  `test` nor `test:int`. Whole-DB tests (expiry, quota) use
  `ExclusivePostgresCollection`.
- **Config parity**: `Config/EnvLoader.cs` mirrors the NestJS `config/env.ts`.
  `Program.BuildApp(args, envOverride)` is the test seam.
- **HTTP parity with Express** (keep when editing):
  - `Http/ErrorEnvelopeMiddleware.cs` maps 405 → 404 and 415 → 400.
  - `ModelStateEnvelope` + `ValidateBodyFilter` are the only validation path.
  - Middleware order: Correlation, Logging, Envelope, Routing, Docs, ApiKey,
    BodyGuard. The API key check stays after routing.
- **Format**: `lint` = `dotnet format --verify-no-changes`; file-scoped namespaces,
  LF, 4 spaces; warnings are errors except NuGet audit NU1901–1904.
