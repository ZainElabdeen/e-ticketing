# Phase 5 — Ticket Service in ASP.NET Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Ticket Service to ASP.NET Core in `apps/ticket-service-dotnet`. The port implements the **same OpenAPI contract** and passes the **identical black-box contract suite** that the NestJS service passes (38 tests). Compose (and later K3s) then runs the .NET image. The payment contract suite, the ledger contract suite and `infra/scripts/smoke.sh` must still pass on top of it.

**Architecture:**

- **Layers** (spec §2.1): controller → application → domain → EF Core repository, as folders in one web project (`TicketService.Api`) plus one test project (`TicketService.Tests`).
- **Data access:** EF Core + Npgsql maps the **existing** `tickets` schema and runs **no migrations** (ADR-0002). The Prisma SQL migrations in `apps/ticket-service` stay the only schema history. The three locking statements are the same parameterized raw SQL as the NestJS service, run inside an explicit READ COMMITTED transaction:
  - the conditional reservation UPDATE;
  - `FOR UPDATE` on confirm;
  - `FOR UPDATE SKIP LOCKED` in the expiry job.
- **Behaviour parity:** the NestJS service is the reference implementation. Everything the contract suite can observe must match it:
  - status codes and error codes;
  - envelope fields;
  - correlation ID handling;
  - key scopes;
  - validation strictness;
  - null fields;
  - date format.

**Tech Stack:** .NET 10 (SDK 10.0.404, installed in `~/.dotnet`), ASP.NET Core Web API (controllers), EF Core + Npgsql, FluentValidation, Serilog (JSON), Swashbuckle `SwaggerUI` (UI only, serving the contract file), xUnit + Testcontainers.PostgreSql + `Microsoft.AspNetCore.Mvc.Testing`, `dotnet format`. Every package is listed in AGENTS.md.

**Spec:** [docs/spec.md](../spec.md): §2.1, §2.2, §3.1, §4.1, §4.5, §6, §7, §7.1, §9. Contract: [ticket-service.yaml](../../packages/contracts/openapi/ticket-service.yaml). Reference implementation: [apps/ticket-service](../../apps/ticket-service). ADRs: 0002, 0004, 0010, 0013, 0015, 0016, 0018.

**Branch:** `phase-5-ticket-dotnet` (already created from `dev`). Do not switch branches.

**Decisions taken for this plan (2026-11-14, by the user):**

- The .NET SDK is installed locally in `~/.dotnet`. No system-wide install, no Docker-only builds.
- A `package.json` wrapper puts the .NET project into `pnpm lint / build / test / test:int` through Turborepo.

## Global Constraints

- **Toolchain**
  - Every shell running `dotnet` first runs:

    ```bash
    export DOTNET_ROOT="$HOME/.dotnet" PATH="$HOME/.dotnet:$PATH" DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
    ```

  - The `package.json` scripts call `apps/ticket-service-dotnet/scripts/dotnet.sh`, which does the same exports, then `exec dotnet "$@"`. pnpm and Turbo therefore work without the user changing their shell profile.
  - Target framework `net10.0`. Pin the SDK with `global.json` (`"version": "10.0.404"`, `"rollForward": "latestFeature"`).
- **Package versions**
  - Use central package management (`Directory.Packages.props`, `ManagePackageVersionsCentrally=true`).
  - Pin every version exactly, resolving each package's latest stable release compatible with net10.0 at execution time.
  - Add no package outside: `Npgsql.EntityFrameworkCore.PostgreSQL`, `FluentValidation` (+ `.DependencyInjectionExtensions`), `Serilog.AspNetCore`, `Serilog.Formatting.Compact` (if needed for JSON), `Swashbuckle.AspNetCore.SwaggerUI`, `xunit` / `xunit.runner.visualstudio` / `Microsoft.NET.Test.Sdk`, `Testcontainers.PostgreSql`, `Microsoft.AspNetCore.Mvc.Testing`.
  - Any other package needs an ADR and a stop-and-ask.
- **No schema changes**
  - Never create EF migrations. Never call `Database.EnsureCreated()` or `Migrate()`.
  - Never edit `apps/ticket-service/prisma/migrations/**`.
  - Never run `prisma migrate dev`. Never read or print `infra/.env`.
- **Routes, identical to the NestJS service**
  - `GET /v1/ticket-types`
  - `POST /v1/orders`
  - `GET /v1/orders/{orderId}`
  - `POST /v1/internal/orders/{orderId}/confirm`
  - `GET /health/live` and `GET /health/ready`
  - `GET /docs` (only when `SWAGGER_ENABLED=true`)
- **Error envelope** on every non-2xx except the two health probes: `{ "statusCode", "code", "message", "correlationId" }`, all camelCase. RFC 7807 ProblemDetails must never be emitted. Codes:
  - `VALIDATION_ERROR` 400
  - `UNAUTHORIZED` 401
  - `FORBIDDEN` 403
  - `NOT_FOUND` 404 (unknown order **and** unknown route)
  - `QUOTA_EXCEEDED` 409
  - `ORDER_NOT_CONFIRMABLE` 409
  - `INTERNAL_ERROR` 500, with the generic message `Internal server error` and the stack logged
  - generic client errors: 413 `PAYLOAD_TOO_LARGE`, 415 `UNSUPPORTED_MEDIA_TYPE`, other unmapped 4xx `BAD_REQUEST`
- **Correlation ID**
  - A request `X-Correlation-Id` that is a UUID is kept. Anything else, or a missing header, gets a new UUID v4.
  - The ID is echoed as the `X-Correlation-Id` response header, in every error body, and as `correlationId` on every request log line.
- **API keys** (`X-Api-Key`, ADR-0010, ADR-0018)
  - Env vars: `PUBLIC_API_KEY_TICKET` and `INTERNAL_API_KEY_TICKET`.
  - Missing or unknown key → 401 `UNAUTHORIZED`.
  - The public key is accepted on `/v1/*` except internal routes, where it gets 403 `FORBIDDEN`.
  - The internal key is accepted everywhere under `/v1/*`.
  - Internal routes are marked with an `[InternalScope]` endpoint-metadata attribute, plus a defense-in-depth check on the normalized path (lowercased, repeated slashes collapsed, prefix `/v1/internal/`). ASP.NET routing is case-insensitive, so `/V1/INTERNAL/...` matches the internal endpoint and the metadata gives 403.
  - Compare keys with `CryptographicOperations.FixedTimeEquals` on UTF-8 bytes, checking lengths first.
  - Health, `/docs` and its assets need no key.
  - An unknown path under `/v1/` checks the key first: no key → 401, a valid key → 404 `NOT_FOUND`.
- **Validation (strict, like the NestJS service)**
  - JSON body binding uses `System.Text.Json` with:
    - `UnmappedMemberHandling = Disallow` (unknown fields → 400);
    - number handling strict (`"2"` is not an int);
    - case-sensitive property names in camelCase.
  - A malformed JSON body → 400 `VALIDATION_ERROR` with the fixed message `Malformed JSON body`. Never echo the parser message.
  - Model-binding failures are mapped to the envelope: `ApiBehaviorOptions.InvalidModelStateResponseFactory`, or `SuppressModelStateInvalidFilter` plus explicit handling.
  - A non-UUID `orderId` path parameter → 400 `VALIDATION_ERROR`. Do **not** use a `{orderId:guid}` route constraint, because that gives 404. Bind a string and parse it.
  - FluentValidation rules equal the NestJS DTOs:
    - `items` is an array of 1–3;
    - each `ticketTypeCode` is in `GOLD|PREMIUM|VIP` and appears at most once;
    - `quantity` is an int 1–10;
    - `transactionId` is a UUID (any version).
- **JSON responses**
  - camelCase.
  - Nulls are **written**: `confirmedAt` and `paidTransactionId` are present as `null`.
  - Money is a JSON integer (C# `long`).
  - Timestamps are UTC ISO-8601 with milliseconds and `Z`, format `yyyy-MM-ddTHH:mm:ss.fffZ`, the same as JS `toISOString()`.
  - UUIDs are lowercase.
  - Items in an order are sorted by `ticketTypeCode`. Ticket types are sorted by `code`.
- **Behaviour (spec §4.1, §4.5)** is identical to `apps/ticket-service/src/orders/*`. Read it before implementing.
  - Reservation: items are sorted by code, then one conditional UPDATE per item inside one transaction, and zero rows → 409 `QUOTA_EXCEEDED` with a full rollback.
  - Times come from DB `now()`.
  - `expires_at = now() + make_interval(mins => ORDER_TTL_MINUTES)`.
  - Confirm locks the order row `FOR UPDATE`, then ticket types in code order, and follows the four branches:
    - REPLAY → return the stored order;
    - REJECT → 409;
    - CONFIRM_PENDING → confirm, moving reserved to sold;
    - CONFIRM_EXPIRED → re-check quota for every item; all items or none, else 409.
  - A unique violation on `orders_paid_transaction_id_key` (SQLSTATE 23505, matched by constraint name) → 409 `ORDER_NOT_CONFIRMABLE`.
  - Expiry job: `ORDER_EXPIRY_INTERVAL_SECONDS` (60), batch `ORDER_EXPIRY_BATCH_SIZE` (100), one transaction per order with `FOR UPDATE SKIP LOCKED LIMIT 1` and a conditional `UPDATE … WHERE status='PENDING'`, enabled by `ORDER_EXPIRY_ENABLED` at wiring time only.
- **Env vars**, the same names and rules as the NestJS service (`apps/ticket-service/src/config/env.ts`):
  - `PORT` (3001)
  - `DATABASE_URL` (Prisma-style `postgresql://user:pw@host:port/db?schema=tickets`; translate it to an Npgsql connection string in code, with `SearchPath` from `schema`)
  - `PUBLIC_API_KEY_TICKET` and `INTERNAL_API_KEY_TICKET`: each ≥ 32 chars, and they must differ
  - `SWAGGER_ENABLED` (false)
  - `LOG_LEVEL` (info)
  - `ORDER_TTL_MINUTES` (15)
  - `ORDER_EXPIRY_INTERVAL_SECONDS` (60)
  - `ORDER_EXPIRY_BATCH_SIZE` (1–1000, 100)
  - `ORDER_EXPIRY_ENABLED` (true)

  The process validates them at startup and exits non-zero on failure, listing every invalid variable.
- **Logging (spec §7)**
  - Serilog writes compact JSON to stdout.
  - Each request log line has `timestamp`, `level`, `service: "ticket-service-dotnet"`, `correlationId`, `method`, `route`, `statusCode` and `durationMs`.
  - Request headers and bodies are never logged.
  - `LOG_LEVEL` maps to Serilog's minimum level.
- **Health**
  - `/health/live` → 200 `{"status":"ok"}`, with no DB access.
  - `/health/ready` runs `SELECT 1` with a 2 s timeout: 200 `{"status":"ok"}`, or 503 `{"status":"error","details":{…}}` within about 2 s.
  - Health bodies bypass the envelope.
- **Shutdown**: the expiry job awaits its in-flight run on `StopAsync`, and the host's shutdown timeout is ≥ 10 s.
- **Tests**
  - Unit tests are xUnit classes tagged `[Trait("Category","Unit")]`.
  - Integration tests are tagged `[Trait("Category","Integration")]`. They use Testcontainers Postgres (`postgres:18-alpine`) bootstrapped like the Node helper:
    1. copy `infra/postgres/init/00-roles.sh` to `/docker-entrypoint-initdb.d/`, with all role passwords `test-password`;
    2. apply every `apps/ticket-service/prisma/migrations/*/migration.sql` in name order, as `tickets_owner`;
    3. connect the app as `tickets_app`.
  - In-process HTTP uses `WebApplicationFactory<Program>`.
- **Commits**: one per task, conventional, with the message given.

## Review Focus

1. **Contract-visible drift from the NestJS service.** Typical drift points: a ProblemDetails body, a 404 instead of a 400 for a malformed GUID, a missing `null` field, a date without milliseconds, PascalCase keys, a 415 for a missing content-type, or model binding accepting `"2"` or an unknown field. The identical TS contract suite must pass against the .NET service in compose (Task 5). Parity integration tests in Tasks 2–3 catch most of this earlier.
2. **Concurrent reservations at the quota edge, with reversed item order.** Never oversell, never deadlock (`40P01`), only `QUOTA_EXCEEDED` failures. Test in Task 3.
3. **Confirm racing the expiry job.** No double release of `reserved`; `sold` counted once; expired-but-paid orders honoured. Test in Task 4.
4. **Key scope bypass.** The public key on `/V1/INTERNAL/orders/{id}/confirm` or `//v1//internal/...` must give 403 or 404, never 200. Test in Task 2.
5. **Malformed or hostile input.** A malformed JSON body, an oversized body (413), a wrong content type (415) and a non-UUID path ID must never give 500 or a ProblemDetails body. Tests in Tasks 2 and 3.

---

## File Structure

```text
apps/ticket-service-dotnet/
  package.json            scripts: lint (dotnet format --verify-no-changes), build, test (Category=Unit), test:int (Category=Integration)
  scripts/dotnet.sh       sets DOTNET_ROOT/PATH, exec dotnet "$@"
  global.json  Directory.Build.props  Directory.Packages.props  .editorconfig  TicketService.sln
  src/TicketService.Api/
    TicketService.Api.csproj  Program.cs  appsettings.json (logging defaults only, no secrets)
    Config/{TicketServiceOptions.cs,EnvLoader.cs}           env → options, validation, DATABASE_URL translation
    Http/{CorrelationIdMiddleware.cs,ApiKeyMiddleware.cs,InternalScopeAttribute.cs,
          ErrorEnvelopeMiddleware.cs,ErrorEnvelope.cs,JsonSetup.cs,RequestLogging.cs,Docs.cs}
    Domain/{TicketTypeCode.cs,OrderStatus.cs,Pricing.cs,ConfirmationDecision.cs,DomainErrors.cs}
    Application/{OrdersService.cs,TicketTypesService.cs}
    Infrastructure/{TicketsDbContext.cs,Entities.cs,OrdersRepository.cs,TicketTypesRepository.cs,
                    PostgresErrors.cs,OrderExpiryJob.cs}
    Controllers/{TicketTypesController.cs,OrdersController.cs,InternalOrdersController.cs,HealthController.cs}
    Contracts/{CreateOrderRequest.cs,ConfirmOrderRequest.cs,OrderView.cs,TicketTypeView.cs,Validators.cs}
  tests/TicketService.Tests/
    TicketService.Tests.csproj
    Support/{PostgresFixture.cs,TicketServiceFactory.cs}
    Unit/*.cs   Integration/*.cs
infra/docker/dotnet-ticket.Dockerfile
infra/docker-compose.yml  (ticket-service → .NET image; NestJS kept under profile "reference")
docs/adr/0021-ticket-service-dotnet-port.md
```

Design notes (not up for change in this phase):

- **One web project, folders by layer.** Splitting into four assemblies adds ceremony and no isolation here, because the dependency rule is enforced by review. The tests sit in a separate project.
- **No repository interfaces.** Same reasoning as the NestJS services: one implementation, integration-tested on real Postgres.
- **EF Core for mapping and simple reads, raw SQL for the locking statements.** Use `Database.SqlQuery<T>($"…")` and `ExecuteSqlAsync($"…")` with interpolated parameters, which EF parameterizes, inside `BeginTransactionAsync(IsolationLevel.ReadCommitted)`. Never concatenate SQL strings. Never use `FromSqlRaw` with string interpolation.

---

### Task 1: Solution scaffold, config, EF mapping, health, test fixture, pnpm wrapper

**Files:**

- Create everything under `apps/ticket-service-dotnet/` listed in File Structure for: `package.json`, `scripts/dotnet.sh`, `global.json`, `Directory.*.props`, `.editorconfig`, `TicketService.sln`, both `.csproj`, `Program.cs`, `Config/*`, `Infrastructure/{TicketsDbContext.cs,Entities.cs}`, `Controllers/HealthController.cs`, `tests/Support/*`, `tests/Unit/EnvLoaderTests.cs`, `tests/Integration/{SchemaMappingTests.cs,HealthTests.cs}`.
- Modify: root `.gitignore` (`bin/`, `obj/`, `TestResults/`), `.prettierignore` (the `apps/ticket-service-dotnet/**` C# files are not Prettier's), `pnpm-workspace.yaml` (already `apps/*`, so nothing to change).

**Interfaces:**

- Produces:

  ```csharp
  public sealed record TicketServiceOptions(int Port, string ConnectionString, string Schema, string PublicKey, string InternalKey,
      bool SwaggerEnabled, string LogLevel, int OrderTtlMinutes, int ExpiryIntervalSeconds, int ExpiryBatchSize, bool ExpiryEnabled);
  public static class EnvLoader { public static TicketServiceOptions Load(IDictionary<string, string?> env); }  // throws InvalidOperationException listing every invalid var
  public static class Program { public static WebApplication BuildApp(string[] args, IDictionary<string, string?>? envOverride = null); }  // used by Main and tests
  // tests
  public sealed class PostgresFixture : IAsyncLifetime { public string UrlFor(string role); /* postgresql://role:test-password@host:port/eticketing?schema=tickets */ public Task<NpgsqlConnection> OpenAsync(string role); }
  public sealed class TicketServiceFactory : WebApplicationFactory<Program> { public TicketServiceFactory(PostgresFixture db, IDictionary<string,string?>? overrides = null); public string PublicKey { get; } public string InternalKey { get; } }
  ```

- [ ] **Step 1: Scaffold the solution.**
  - `dotnet new sln`, a web project (controllers) and an xUnit project, with `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>` and `<ImplicitUsings>enable</ImplicitUsings>` in `Directory.Build.props`.
  - Central package versions, `global.json`, and an `.editorconfig` that `dotnet format` uses.
  - `package.json`:

    ```json
    {
      "name": "@eticket/ticket-service-dotnet",
      "private": true,
      "scripts": {
        "build": "sh scripts/dotnet.sh build TicketService.sln -c Release",
        "lint": "sh scripts/dotnet.sh format TicketService.sln --verify-no-changes",
        "test": "sh scripts/dotnet.sh test TicketService.sln --filter Category=Unit",
        "test:int": "sh scripts/dotnet.sh test TicketService.sln --filter Category=Integration"
      }
    }
    ```

  Run: `pnpm --filter @eticket/ticket-service-dotnet build` → succeeds.

- [ ] **Step 2: Env unit tests first, then `EnvLoader`.** Use the same rules and defaults as the NestJS `validateEnv`:
  - defaults (3001, 15, 60, 100, true, false, info);
  - a short key → error naming it;
  - equal keys → error naming `INTERNAL_API_KEY_TICKET`;
  - a missing `DATABASE_URL` → error;
  - `"false"` parses to false;
  - `DATABASE_URL` translation: host, port, database, username, password and `SearchPath=tickets`; a URL-encoded password is decoded;
  - all invalid variables listed in one error.

  `Program.Main` prints the error to stderr and exits 1.

  Run: `pnpm --filter @eticket/ticket-service-dotnet test` → FAIL, then PASS.

- [ ] **Step 3: EF mapping.**
  - `TicketsDbContext` maps `ticket_types`, `orders` and `order_items` with explicit column names (snake_case), `HasDefaultSchema("tickets")`, `uuid`, `char(3)`, `bigint` → `long` and `timestamptz` → `DateTime` (UTC).
  - No migrations; tracking is off for reads.
  - `PostgresFixture` is implemented per Global Constraints.
  - Write the failing `SchemaMappingTests`:
    1. Load the three ticket types through the DbContext as `tickets_app`.
    2. Assert codes, prices (10000/20000/50000), `currency == "AED"` and `quota == 100`.
    3. Insert an order plus one item through raw SQL, then read it back through the context, so every mapped column round-trips.

  Run: `pnpm --filter @eticket/ticket-service-dotnet test:int` → FAIL, then PASS.

- [ ] **Step 4: `BuildApp`, health and `TicketServiceFactory`.**
  - The Npgsql data source uses the translated connection string, with `Timeout=5` for connects.
  - `HealthController`:
    - live → `{"status":"ok"}`;
    - ready → `SELECT 1` with a 2 s CancellationToken, 200 or 503 `{"status":"error","details":{"database":{"status":"down"}}}`.
  - Write the failing `HealthTests`:
    - live is 200 with no key;
    - ready is 200;
    - ready with `DATABASE_URL` at `127.0.0.1:1` → 503 in under 3 s, while live stays 200.

  Run → PASS.

- [ ] **Step 5: Commit.**
  Run: `pnpm --filter @eticket/ticket-service-dotnet lint && pnpm --filter @eticket/ticket-service-dotnet build && pnpm --filter @eticket/ticket-service-dotnet test && pnpm --filter @eticket/ticket-service-dotnet test:int && pnpm format:check` → pass.

  ```bash
  git add apps/ticket-service-dotnet .gitignore .prettierignore pnpm-lock.yaml
  git commit -m "feat(ticket-service-dotnet): scaffold ASP.NET Core service with config, EF mapping, health and pnpm wrapper"
  ```

---

### Task 2: HTTP cross-cutting — envelope, correlation, strict JSON, key scopes, logging, /docs

**Files:**

- Create: `Http/*` (File Structure), `tests/Integration/HttpBehaviourTests.cs`, `tests/Unit/ApiKeyMiddlewareTests.cs`, `tests/Unit/CorrelationIdTests.cs`.
- Modify: `Program.cs`.

**Interfaces:**

- Produces:

  ```csharp
  public static class CorrelationId { public const string Header = "X-Correlation-Id"; public static string Of(HttpContext ctx); }  // resolves once, caches in HttpContext.Items
  [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)] public sealed class InternalScopeAttribute : Attribute {}
  public abstract class DomainException(string message) : Exception(message) { public abstract string Code { get; } public abstract int StatusCode { get; } }
  public sealed class OrderNotFoundException : DomainException {}       // NOT_FOUND 404
  public sealed class QuotaExceededException : DomainException {}      // QUOTA_EXCEEDED 409, message names the ticket type code
  public sealed class OrderNotConfirmableException : DomainException {} // ORDER_NOT_CONFIRMABLE 409
  public sealed record ErrorEnvelope(int StatusCode, string Code, string Message, string CorrelationId);
  ```

  - Middleware order:
    1. correlation;
    2. request logging;
    3. error envelope (catches everything);
    4. routing;
    5. API key, which reads endpoint metadata after routing;
    6. endpoints;
    7. a terminal 404 fallback for unmatched paths, which still runs the key check under `/v1/`.
  - Health endpoints carry `[AllowAnonymous]`-style metadata (`[PublicEndpoint]`) so the key middleware skips them. `/docs` is mapped before the key middleware.
  - Body size limit: Kestrel `MaxRequestBodySize` stays at the default. An over-limit body gives 413 `PAYLOAD_TOO_LARGE`, mapped from `BadHttpRequestException` with status 413.
  - A non-JSON content type on a JSON endpoint gives 415 `UNSUPPORTED_MEDIA_TYPE`, which is what the NestJS service does for `text/plain`. Check `apps/ticket-service` behaviour with a quick request and match it; record the observed status in the report.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:**
    - The key middleware against a stubbed `HttpContext` plus endpoint metadata:
      - no key → 401;
      - wrong key, including a different length → 401, with no exception;
      - public key on an `[InternalScope]` endpoint → 403;
      - public key on `/V1/INTERNAL/x` and `//v1//internal/x` paths → 403;
      - internal key everywhere → passes;
      - a public endpoint → passes with no key.
    - Correlation:
      - a UUID header is kept;
      - `not-a-uuid` is replaced;
      - a missing header gets a new ID;
      - the response header is set.
  - **Integration** (`HttpBehaviourTests`), with a temporary test-only `[InternalScope]` controller registered only in the test factory, so the scope can be tested before Task 4:
    - `GET /v1/nope` with no key → 401 envelope; with the public key → 404 `NOT_FOUND` envelope with `correlationId`;
    - a UUID `X-Correlation-Id` is echoed in the body and the header;
    - the public key on the test internal route → 403 `FORBIDDEN`; on `/V1/INTERNAL/test` → 403 or 404, never 2xx;
    - every error body has exactly the four camelCase keys, and the `content-type` is `application/json`, never `application/problem+json`;
    - a malformed JSON body on the test POST route → 400 `VALIDATION_ERROR`, message exactly `Malformed JSON body`, and the body contains no part of the payload;
    - a body over the limit → 413 `PAYLOAD_TOO_LARGE`;
    - a thrown unexpected exception → 500 `INTERNAL_ERROR`, message `Internal server error`, no stack in the body;
    - `/health/live` is still a bare `{"status":"ok"}`;
    - `/docs` with `SWAGGER_ENABLED=true` → 200 HTML; when disabled → not 200;
    - logging: capture Serilog output through a test sink. One request yields a line with all eight spec §7 fields, `durationMs` is a number, and the `X-Api-Key` value appears nowhere.

  Run: `pnpm --filter @eticket/ticket-service-dotnet test && pnpm --filter @eticket/ticket-service-dotnet test:int` → FAIL.

- [ ] **Step 2: Implement.**
  - `/docs` serves the bundled contract: `@eticket/contracts` `dist/ticket-service.json`, copied into the build output at `openapi.json` by an MSBuild `Content` item pointing at `../../../packages/contracts/dist/ticket-service.json`. Fail the build with a clear message if it is missing, and tell the user to run `pnpm --filter @eticket/contracts build`.
  - Serve it at `/docs/openapi.json` with `UseSwaggerUI(c => c.SwaggerEndpoint("/docs/openapi.json", …); c.RoutePrefix = "docs")`.
  - Make the Turbo build of this package depend on contracts: `package.json` `devDependencies: { "@eticket/contracts": "workspace:*" }`.

  Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/ticket-service-dotnet pnpm-lock.yaml
  git commit -m "feat(ticket-service-dotnet): add error envelope, correlation ID, strict JSON, scoped API keys, logging and /docs"
  ```

---

### Task 3: Ticket types, create and read orders with atomic reservation

**Files:**

- Create: `Domain/{TicketTypeCode.cs,OrderStatus.cs,Pricing.cs}`, `Application/{TicketTypesService.cs,OrdersService.cs}`, `Infrastructure/{TicketTypesRepository.cs,OrdersRepository.cs}`, `Controllers/{TicketTypesController.cs,OrdersController.cs}`, `Contracts/{CreateOrderRequest.cs,OrderView.cs,TicketTypeView.cs,Validators.cs}`, `tests/Unit/PricingTests.cs`, `tests/Integration/{TicketTypesTests.cs,OrdersTests.cs,ReservationRaceTests.cs}`.

**Interfaces:**

- Produces:

  ```csharp
  public static class Pricing {
    public static IReadOnlyList<T> SortLines<T>(IEnumerable<T> lines, Func<T, string> code);      // ordinal by code
    public static (long TotalMinor, string Currency) Price(IReadOnlyList<PricedLine> lines);       // throws on line-total mismatch or mixed currency
  }
  public sealed record PricedLine(string TicketTypeCode, Guid TicketTypeId, int Quantity, long UnitPriceMinor, long LineTotalMinor, string Currency);
  public sealed record OrderView(Guid Id, string Status, IReadOnlyList<OrderItemView> Items, long TotalMinor, string Currency,
      string CreatedAt, string ExpiresAt, string? ConfirmedAt, Guid? PaidTransactionId);   // timestamps preformatted per Global Constraints
  public sealed class OrdersRepository { Task<OrderView> ReserveAndCreateAsync(IReadOnlyList<(string Code, int Qty)> lines, int ttlMinutes, CancellationToken ct); Task<OrderView?> FindAsync(Guid id, CancellationToken ct); }
  ```

  - `ReserveAndCreateAsync` copies `apps/ticket-service/src/orders/orders.repository.ts` `reserveAndCreate` step for step:
    1. sort the lines;
    2. per line, run:

       ```sql
       UPDATE tickets.ticket_types SET reserved = reserved + {qty} WHERE code = {code} AND sold + reserved + {qty} <= quota RETURNING id, price_minor, currency
       ```

    3. zero rows → `QuotaExceededException`, which rolls back;
    4. insert the order with `now()`-based times and the currency from the returned rows;
    5. insert the items;
    6. re-read and map.

    All of it runs in one READ COMMITTED transaction.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** sort order; GOLD×2 + VIP×1 → 70000; a mismatched line total throws; mixed currency throws.
  - **Integration:**
    - `GET /v1/ticket-types` returns codes in order with prices, AED, quota 100, `available = quota − sold − reserved`, and the exact key set `code,name,priceMinor,currency,quota,sold,reserved,available`.
    - **Create:** `POST /v1/orders` GOLD×2 + VIP×1 → 201, `status PENDING`, `totalMinor 70000`, items sorted, `confirmedAt` and `paidTransactionId` **present and null**, `expiresAt − createdAt` = 15 min ± 5 s, both timestamps matching `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`.
    - **Read:** `GET /v1/orders/{id}` returns a body equal to the create response.
    - **Unknown order:** an unknown UUID → 404 `NOT_FOUND`.
    - **Bad path ID:** `GET /v1/orders/not-a-uuid` → **400** `VALIDATION_ERROR`.
    - **Uppercase ID:** an uppercase UUID in the path → 200, with the `id` in lowercase.
    - **Bad bodies → 400 `VALIDATION_ERROR`:**
      - `{}`
      - `items: []`
      - four items
      - quantity 0
      - quantity 11
      - quantity `"2"`
      - quantity `1.5`
      - `ticketTypeCode: "BRONZE"`
      - a duplicate GOLD
      - an extra top-level field
      - an extra item field
      - malformed JSON
    - **Quota drain:**
      1. Read VIP availability, then drain it in chunks of ≤ 10.
      2. GOLD×1 + VIP×1 → 409 `QUOTA_EXCEEDED`.
      3. GOLD availability is unchanged.
    - **Race (Review Focus 2):**
      1. Set GOLD and VIP to quota 5.
      2. Send 12 concurrent `[GOLD,VIP]` orders and 12 concurrent `[VIP,GOLD]` orders through HTTP.
      3. Exactly 5 get 201 and 19 get 409 `QUOTA_EXCEEDED`. There is no 500 and no deadlock.
      4. `reserved` is 5 for both types.
    - **Server-side pricing:** after setting GOLD `price_minor = 12345` by SQL, GOLD×3 → total 37035.

  Run: `pnpm --filter @eticket/ticket-service-dotnet test && pnpm --filter @eticket/ticket-service-dotnet test:int` → FAIL.

- [ ] **Step 2: Implement.** Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/ticket-service-dotnet
  git commit -m "feat(ticket-service-dotnet): list ticket types and create server-priced orders with atomic reservation"
  ```

---

### Task 4: Confirm order and the expiry job

**Files:**

- Create: `Domain/ConfirmationDecision.cs`, `Infrastructure/{PostgresErrors.cs,OrderExpiryJob.cs}`, `Controllers/InternalOrdersController.cs`, `Contracts/ConfirmOrderRequest.cs`, `tests/Unit/ConfirmationDecisionTests.cs`, `tests/Integration/{ConfirmTests.cs,ExpiryTests.cs}`.
- Modify: `OrdersRepository.cs`, `OrdersService.cs`, `Program.cs`.
- Remove the temporary test-only internal controller from Task 2 once the real one exists, and point those tests at the confirm route.

**Interfaces:**

- Produces:

  ```csharp
  public enum ConfirmationDecision { Replay, ConfirmPending, ConfirmExpired, Reject }
  public static class Confirmation { public static ConfirmationDecision Decide(string status, Guid? paidTransactionId, Guid transactionId); }
  // OrdersRepository
  Task<OrderView> ConfirmAsync(Guid orderId, Guid transactionId, CancellationToken ct);   // OrderNotFoundException | OrderNotConfirmableException
  Task<Guid?> ExpireOneAsync(CancellationToken ct);
  // OrderExpiryJob : BackgroundService — RunOnceAsync(CancellationToken) => int; PeriodicTimer(ORDER_EXPIRY_INTERVAL_SECONDS); skip-if-running; registered only when ORDER_EXPIRY_ENABLED
  public static class PostgresErrors { public static bool IsUniqueViolation(Exception e, string constraint); }  // walks inner exceptions for PostgresException SqlState 23505 + ConstraintName exact match
  ```

  - `ConfirmAsync` and `ExpireOneAsync` mirror the NestJS repository's `confirm` and `expireOne` exactly, including the lock order, the CONFIRM_EXPIRED guarded update with all-or-nothing rollback, the pre-check plus unique-violation backstop for a reused transaction ID, and the conditional expiry update.
  - `InternalOrdersController` carries `[InternalScope]` and maps `POST v1/internal/orders/{orderId}/confirm`. It binds `orderId` as a string and parses it (non-UUID → 400), validates the body (`transactionId` UUID, no extra fields) and returns 200.
  - `OrderExpiryJob` gets the interval and batch from options. Its errors are logged with the exception and `correlationId: "job:order-expiry"` and never crash the host. `StopAsync` awaits the in-flight run.

- [ ] **Step 1: Write the failing tests.**
  - **Unit:** the four `Decide` cases.
  - **Integration** (`ConfirmTests`):
    - **Confirm a PENDING order:** GOLD×2 → 200 `CONFIRMED` with `paidTransactionId` and `confirmedAt` set, `sold +2` and `reserved −2`.
    - **Replay and conflicts:**
      - the same transaction again → 200 with a deep-equal body;
      - another transaction → 409 `ORDER_NOT_CONFIRMABLE`;
      - transaction T reused on another order → 409.
    - **Not found:** unknown order → 404.
    - **Invalid input → 400:**
      - a non-UUID path;
      - `{}`;
      - `{transactionId:"x"}`;
      - an extra field.
    - **Key scopes:**
      - the public key → 403;
      - the public key on `/V1/INTERNAL/orders/{id}/confirm` → 403 or 404;
      - the internal key on `GET /v1/orders/{id}` → 200.
    - **Expired but quota allows:** the order is honoured and `sold` increments.
    - **Expired, quota gone:** 409, the order stays EXPIRED and `sold` is unchanged for every item.
    - **5 concurrent confirms with the same transaction:** all `CONFIRMED`, and `sold` rises once.
    - **4 orders racing on one transaction:** exactly one confirmed, three 409, no 500.
  - **Integration** (`ExpiryTests`, `ORDER_EXPIRY_ENABLED=false`, job resolved from DI):
    - **Expires due orders:** a due order → `RunOnceAsync` 1, EXPIRED, `reserved −3`; a second run → 0.
    - **Skips the rest:** a non-due order and a CONFIRMED-but-past order are left alone.
    - **Batch size:** batch 2 with 3 due orders → 2, then 1.
    - **Confirm racing expiry (Review Focus 3):**
      1. Create 20 GOLD×1 orders, all due.
      2. Run `Task.WhenAll(job.RunOnceAsync, 20× ConfirmAsync)`.
      3. All 20 are CONFIRMED, `reserved == 0`, `sold == 20`, and nothing throws.
    - **Hosted service registration:** with `ORDER_EXPIRY_ENABLED=true` the hosted service is registered; with false it is not.

  Run → FAIL.

- [ ] **Step 2: Implement.** Run: `pnpm --filter @eticket/ticket-service-dotnet test && pnpm --filter @eticket/ticket-service-dotnet test:int` → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/ticket-service-dotnet
  git commit -m "feat(ticket-service-dotnet): confirm paid orders idempotently and expire unpaid orders with SKIP LOCKED"
  ```

---

### Task 5: Container, compose switch, identical contract suite, smoke, docs, phase gate

**Files:**

- Create: `infra/docker/dotnet-ticket.Dockerfile`, `infra/scripts/contract.sh`, `infra/scripts/contract.mjs`, `docs/adr/0021-ticket-service-dotnet-port.md`.
- Modify: `infra/docker-compose.yml`, `AGENTS.md` (Commands), `packages/contract-tests/README.md`, `docs/spec.md` (§2.1 note and §13 row).

- [ ] **Step 1: Dockerfile.**
  - Build stage `mcr.microsoft.com/dotnet/sdk:10.0`; runtime stage `mcr.microsoft.com/dotnet/aspnet:10.0-alpine`. Check that `wget` exists in it for the HEALTHCHECK; otherwise use the `curl` from an Alpine package, or a tiny `dotnet` health probe.
  - The build context is the repo root. Copy `packages/contracts/dist/ticket-service.json` and the .NET sources, then `dotnet publish -c Release -o /out`.
  - The runtime stage runs as the non-root `app` user (built into the image), sets `ENV PORT=3001` and `EXPOSE 3001`, has a HEALTHCHECK on `/health/live`, and starts with `ENTRYPOINT ["dotnet","TicketService.Api.dll"]`. Kestrel listens on `http://0.0.0.0:${PORT}`, configured in code from options.
  - The image must also build for `linux/arm64` (Phase 9), so avoid architecture-specific RIDs.
  - The contract JSON must exist before the docker build. Document `pnpm --filter @eticket/contracts build` as a prerequisite, or build the bundle in an earlier Node stage. Prefer an earlier `node:26-alpine` stage that runs the redocly bundle, so `docker compose up --build` works from a clean checkout.

  Run: `docker build -f infra/docker/dotnet-ticket.Dockerfile -t eticket/ticket-service-dotnet:dev .` → succeeds.

- [ ] **Step 2: Compose switch.**
  - The `ticket-service` service now builds `infra/docker/dotnet-ticket.Dockerfile`. The env is the same as before: `PORT`, `DATABASE_URL` with `?schema=tickets`, both keys, `SWAGGER_ENABLED`, `LOG_LEVEL`. Same ports and healthcheck.
  - Add `ticket-service-node` under `profiles: ["reference"]`: the NestJS image on host port `127.0.0.1:3011:3001`, the same env and the same DB. It runs only on `--profile reference`, so the contract suite can be pointed at both.

- [ ] **Step 3: A contract runner script, then the identical suite, smoke, and both implementations.**

  First create `infra/scripts/contract.sh <ticket|payment|ledger> [ticketBaseUrl]` and `infra/scripts/contract.mjs`.
  - `contract.sh` runs `node --env-file=infra/.env infra/scripts/contract.mjs "$@"`. There is no shell-sourcing, because a bcrypt `$` would break it in Phase 6.
  - `contract.mjs` maps the loaded keys to the `CONTRACT_*` variables the suites expect, using the README table:
    - ticket uses `PUBLIC_API_KEY_TICKET` and `INTERNAL_API_KEY_TICKET`, with base URL `ticketBaseUrl` or `http://127.0.0.1:3001`;
    - payment uses `PUBLIC_API_KEY_PAYMENT` and the ticket public key;
    - ledger uses `PUBLIC_API_KEY_LEDGER` and `INTERNAL_API_KEY_LEDGER`.

    It then spawns `pnpm --filter @eticket/contract-tests test:contract:<suite>` with that env and exits with its code. It never prints a key.

  On a fresh volume:

  ```bash
  docker compose -f infra/docker-compose.yml down -v
  docker compose -f infra/docker-compose.yml up -d --build --wait ticket-service payment-service ledger-service
  infra/scripts/contract.sh ticket                       # .NET on :3001 → expect 38/38 (same as the NestJS run)
  infra/scripts/contract.sh payment                      # expect 16/16
  infra/scripts/contract.sh ledger                       # expect 14/14; outbox events end DONE
  docker compose -f infra/docker-compose.yml down -v && infra/scripts/smoke.sh   # expect SMOKE OK on .NET
  docker compose -f infra/docker-compose.yml --profile reference up -d --build --wait ticket-service-node
  infra/scripts/contract.sh ticket http://127.0.0.1:3011 # NestJS reference → expect 38/38
  ```

  Results:
  1. The .NET Ticket Service passes **38/38**, the same count as the NestJS run.
  2. The payment suite passes 16/16 and the ledger suite 14/14, with outbox events ending DONE.
  3. The smoke test prints `SMOKE OK`, running on the .NET Ticket Service.
  4. The NestJS reference on `:3011` also passes 38/38, so both implementations pass the identical suite.
  5. Key-leak counts in the `ticket-service` logs → 0.
  6. Run `down -v` at the end.

- [ ] **Step 4: Docs.**
  - **ADR-0021** (context, decision, alternatives, trade-off). Decisions:
    - one web project with folders by layer;
    - EF Core maps the Prisma-owned schema with no migrations;
    - raw SQL for the locking statements;
    - a middleware pipeline replicating the NestJS envelope and key scopes;
    - Serilog JSON;
    - `/docs` serves the contract file;
    - compose runs .NET, and NestJS stays as the reference under a profile;
    - the contract suite is the parity gate.

    Rejected alternatives: Minimal APIs, four assemblies, EF migrations, Dapper.
  - **Spec:** a §13 row, and a one-line note in §2.1 that the deployed Ticket Service is now the .NET one.
  - **AGENTS.md Commands:**
    - `.NET Ticket Service: pnpm --filter @eticket/ticket-service-dotnet test | test:int` (written as two separate commands);
    - `.NET SDK: ~/.dotnet (scripts/dotnet.sh sets PATH)`;
    - how to run the reference NestJS service with `--profile reference`.
  - **contract-tests README:** how to point the ticket suite at either implementation.

- [ ] **Step 5: Phase gate**, from a clean state:

  ```bash
  docker compose -f infra/docker-compose.yml down -v
  pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check
  infra/scripts/verify-db.sh && infra/scripts/smoke.sh
  ```

  Expected:
  - everything passes, and `pnpm lint/build/test/test:int` now include `@eticket/ticket-service-dotnet` through the wrapper;
  - `verify-db.sh` prints `DB OK`;
  - smoke prints `SMOKE OK`.

  Report per-suite counts, including the .NET unit and integration counts.

- [ ] **Step 6: Commit.**

  ```bash
  git add infra apps/ticket-service-dotnet docs AGENTS.md packages/contract-tests/README.md
  git commit -m "feat(infra): run the .NET Ticket Service in compose; both implementations pass the identical contract suite"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-14-phase-5-ticket-dotnet.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task, and a reviewer checks it before the next one starts. Tasks 2–4 (parity and concurrency) get Opus reviewers.

**B — OpenCode hand-off (saves Claude tokens).** You are already on `phase-5-ticket-dotnet`. From the repo root:

```bash
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-14-phase-5-ticket-dotnet.md. \
You are on branch phase-5-ticket-dotnet; do not switch or create branches. Before any dotnet \
command run: export DOTNET_ROOT=\$HOME/.dotnet PATH=\$HOME/.dotnet:\$PATH DOTNET_CLI_TELEMETRY_OPTOUT=1. \
Execute the plan's tasks 1 to 5 in order. For each task follow every step exactly, write the \
failing test before the code, run every Run command and compare with Expected, and make the \
commit given in the task. The NestJS service in apps/ticket-service is the reference: read its \
code before implementing each behaviour. Never create EF migrations, never edit Prisma \
migrations or packages/contracts/openapi, never run 'prisma migrate dev', never read or print \
infra/.env. Pin exact package versions; add no package outside the plan's list. If a \
verification still fails after two fix attempts, stop and report the task, the command and its \
full output; never skip or weaken a test. Finish by printing each task's commit hash and the \
full Task 5 phase-gate output."
```

**After either option**, back in Claude Code (Opus):

- a whole-branch review on Opus, then one fix wave;
- the EGM drift check against spec §2.1, §4.1, §4.5 and §6;
- the phase summary.
