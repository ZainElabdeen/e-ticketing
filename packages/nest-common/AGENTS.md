# NestJS conventions (all four Nest apps)

Shared by `apps/gateway`, `apps/ticket-service`, `apps/payment-service`,
`apps/ledger-service`. Each app's own `AGENTS.md` adds service facts.

## Reuse before writing

`src/index.ts` exports: `ApiKeyGuard`, `API_KEYS`, `@Public()`, `@Internal()`,
`configureApp`, `pinoHttpOptions`, `correlationIdOf`, `ErrorEnvelopeFilter`,
`DomainError`, `FallbackModule`, `isUniqueViolation(err, constraint)`, `toMinor`,
`schemaOf`, `createValidationPipe`, `trimTrailingSlashes`,
`HealthModule.forRoot({ checks, imports, timeoutMs, drainMs })` (check
dependencies must come from an imported module that exports them), `ReadinessCheck`,
`prismaReadinessCheck(token)`, `ShutdownState`,
`resolveContractFile(distDir, service)`, `bootstrapService(createApp)`, `runIfMain(module, fn)`. A helper needed by two services belongs here
(ADR-0020).

## App wiring

- `app.module.ts` exports `createAppModule(env, options)` over an already
  validated env (`ConfigModule` with `ignoreEnvVars: true`); `main.ts` exports
  `createApp(env, opts)`. Tests use these seams, never `process.env`.
- `config/env.ts` is a class-validator class that fails fast. Every new variable
  goes into it and into the app's `.env.example`.
- `FallbackModule` is the LAST import of `AppModule`.
- `APP_GUARD: ApiKeyGuard` is registered in every service except the gateway.
  Internal routes need both `@Internal()` and the `/v1/internal/` path prefix.

## Errors and validation

- Business errors: throw a `DomainError` subclass (`httpStatus`, `code`). The
  filter renders `{statusCode, code, message, correlationId}`.
- The validation pipe uses `whitelist`, `forbidNonWhitelisted`, `transform` and
  no implicit conversion: numeric query params need `@Type(() => Number)`.
  Messages never echo the value (`$value`).

## Data access

- Prisma carries migrations and the client only. Queries are `$queryRaw` /
  `$executeRaw` with schema-qualified tables and explicit `::uuid` casts;
  `bigint` columns pass through `toMinor()`.
- The client is generated into `src/generated/prisma` (gitignored). The package
  scripts run `prisma generate` first; before using `tsc` or an editor directly
  run `pnpm --filter <app> generate`.
- Schema changes follow the `sql-migration` skill.

## Jobs

`setInterval` registered through `SchedulerRegistry` in `onModuleInit`, an
`*_ENABLED` env flag, a public `runOnce()` that tests drive directly, and
`beforeApplicationShutdown` awaiting the in-flight run.

## Tests

- Unit: `src/**/*.spec.ts` (`jest.config.cjs`).
- Integration: `test/*.int-spec.ts` (`jest.int.config.cjs`), Postgres through
  Testcontainers from `@eticket/testing`, helpers in `test/support/`.
- Every app has `test/contract.int-spec.ts` asserting responses against
  `@eticket/contracts`; DB-backed apps also have `test/prisma-drift.int-spec.ts`.
