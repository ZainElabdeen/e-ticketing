# Ticket Service (.NET)

The ASP.NET Core Ticket Service; the image compose runs as `ticket-service`.
ADR-0021, ADR-0031. Its behaviour is pinned by the black-box contract suite.

- **Build needs the contract**: `TicketService.Api.csproj` fails unless
  `packages/contracts/dist/ticket-service.json` exists. Run
  `pnpm --filter @eticket/contracts build` first. The Dockerfile bundles it itself.
- **Schema is owned by the SQL migrations** in `prisma/migrations` of this app
  (ADR-0015, ADR-0031), applied by `prisma migrate deploy`. There are no EF
  migrations; `Infrastructure/TicketsDbContext.cs` is a hand-mapped, untracked
  read model and `SchemaMappingTests` guards column drift.
- **Writes are raw SQL** (`SqlQuery` / `ExecuteSqlAsync` interpolated strings,
  parameterized by EF). Keep the single conditional UPDATE and the ascending
  code lock order (`Pricing.SortLines`).
- **Test categories**: every test class has
  `[Trait("Category", "Unit" | "Integration")]`; an untagged test runs in neither
  `test` nor `test:int`. Whole-DB tests (expiry, quota) use
  `ExclusivePostgresCollection`.
- **Config**: `Config/EnvLoader.cs` loads and validates the env.
  `Program.BuildApp(args, envOverride)` is the test seam.
- **HTTP behaviour pinned by the contract suite** (keep when editing):
    - `Http/ErrorEnvelopeMiddleware.cs` maps 405 → 404 and 415 → 400.
    - `ModelStateEnvelope` + `ValidateBodyFilter` are the only validation path.
    - Middleware order: Correlation, Logging, Envelope, Routing, Docs, ApiKey,
      BodyGuard. The API key check stays after routing.
- **Format**: `lint` = `dotnet format --verify-no-changes`; file-scoped namespaces,
  LF, 4 spaces; warnings are errors except NuGet audit NU1901–1904.
