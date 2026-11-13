# Phase 2 — Ticket Service (NestJS) and Contract Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable NestJS Ticket Service (ticket types, server-priced orders with atomic quota reservation, idempotent confirmation, an expiry job) that passes a black-box contract suite. The suite validates every response against `packages/contracts/openapi/ticket-service.yaml` and runs against any base URL.

**Architecture:** Layers per AGENTS.md: controller → application service → domain → repository. The domain is plain TypeScript (pricing, the confirmation decision, typed errors) and is unit-tested with `new`. Repositories use Prisma Client 7 (`@prisma/adapter-pg`): the typed API for plain reads and inserts, and `$queryRaw` inside `$transaction` for the three locking statements (conditional reservation UPDATE, `FOR UPDATE`, `FOR UPDATE SKIP LOCKED`). The new package `packages/contract-tests` exports the suite. It has two runners: the ticket-service `test:int` (Testcontainers Postgres plus the app in-process on a random port) and a standalone `test:contract` against `CONTRACT_BASE_URL`.

**Tech Stack:** Node 26, NestJS (latest stable major; all `@nestjs/*` on one version), Prisma 7.10.1 + `@prisma/client` + `@prisma/adapter-pg`, `pg` 8, `@nestjs/config`, `class-validator` + `class-transformer`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/schedule`, `nestjs-pino` + `pino-http`, Jest 30 + ts-jest, Supertest, Ajv 8 + `ajv-formats` 3, Testcontainers 11.

**Spec:** [docs/spec.md](../spec.md): §2.2 (keys, correlation), §3.1 (tickets schema), §4.1 (orders, reservation, expiry job), §4.5 (confirmation), §6 (API conventions), §7 (cross-cutting, env vars), §8 (testing). Wire shapes: [ticket-service.yaml](../../packages/contracts/openapi/ticket-service.yaml) and [common.yaml](../../packages/contracts/openapi/common.yaml). Rules: [AGENTS.md](../../AGENTS.md).

**Branch:** `phase-2-ticket-service` (already created from `dev`). Do not switch branches.

**Decisions taken for this plan (2026-11-13, by the user):** Prisma with raw SQL for the locking statements; Ajv against the bundled contract (ADR-0016, Task 1); a shared suite package with two runners; `/docs` serves the contract file, with no `@ApiProperty` decorators.

## Global Constraints

- Everything in the Phase 1 plan's Global Constraints still holds: Node 26, exact pinned versions (no `^`/`~`), resolve each major with `npm view <pkg>@<major> version`, `@eticket/*` scope, never `prisma migrate dev`, never read or print `infra/.env`, and the throwaway test password `test-password`.
- `prisma`, `@prisma/client` and `@prisma/adapter-pg` all pinned to `7.10.1`, the same as the `x-prisma-version` anchor in `infra/docker-compose.yml`.
- The SQL migration in `apps/ticket-service/prisma/migrations/` is **not edited**. If a Prisma model disagrees with the SQL, fix the model.
- Routes: `GET /v1/ticket-types`, `POST /v1/orders`, `GET /v1/orders/{orderId}`, `POST /v1/internal/orders/{orderId}/confirm`, `GET /health/live`, `GET /health/ready`, `GET /docs` (only when `SWAGGER_ENABLED=true`).
- Error envelope on every non-2xx except health: `{ statusCode, code, message, correlationId }`. Codes used by this service: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404 (unknown order and unknown route), `QUOTA_EXCEEDED` 409, `ORDER_NOT_CONFIRMABLE` 409, `INTERNAL_ERROR` 500.
- **API keys** (`X-Api-Key`):
  - Missing or unknown key → 401 `UNAUTHORIZED`.
  - `PUBLIC_API_KEY_TICKET` is accepted on every `/v1/*` route except `/v1/internal/*`, where it gets 403 `FORBIDDEN`.
  - `INTERNAL_API_KEY_TICKET` is accepted on every `/v1/*` route. The Payment Service holds only this key and also calls `GET /v1/orders/{id}`. Task 3 records this in spec §2.2.
  - Compare keys with `crypto.timingSafeEqual` on equal-length buffers.
  - Health routes and `/docs` need no key.
- **Correlation ID**:
  - A request `X-Correlation-Id` that is a UUID is kept. Anything else, or a missing header, gets a new UUID v4.
  - The ID is echoed as the `X-Correlation-Id` response header, sits in every error body and is the `correlationId` field of every request log line.
- **Validation**:
  - Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`, and **no** `enableImplicitConversion`, so `"2"` is not a quantity.
  - Every validation failure → 400 `VALIDATION_ERROR`, including malformed JSON and a non-UUID `orderId` (`ParseUUIDPipe`).
- Money: `price_minor`/`total_minor` are `bigint` in Postgres and `BigInt` in Prisma. The domain and JSON use `number`. Convert in the repository mapper with `toMinor(value: bigint): number`, which throws if `!Number.isSafeInteger`. A `BigInt` must never reach `JSON.stringify`.
- Env vars (validated at boot with `class-validator`; the process exits non-zero on any failure):

  | Variable | Rule | Default |
  | --- | --- | --- |
  | `PORT` | int 1–65535 | `3001` |
  | `DATABASE_URL` | required | — |
  | `PUBLIC_API_KEY_TICKET` | required, ≥ 32 chars | — |
  | `INTERNAL_API_KEY_TICKET` | required, ≥ 32 chars, ≠ the public key | — |
  | `SWAGGER_ENABLED` | `true` / `false` | `false` |
  | `LOG_LEVEL` | pino level | `info` |
  | `ORDER_TTL_MINUTES` | int ≥ 1 | `15` |
  | `ORDER_EXPIRY_INTERVAL_SECONDS` | int ≥ 1 | `60` |
  | `ORDER_EXPIRY_BATCH_SIZE` | int 1–1000 | `100` |
  | `ORDER_EXPIRY_ENABLED` | `true` / `false` | `true` |

  `ORDER_EXPIRY_ENABLED=false` exists so integration tests can drive the job by hand. It is wiring, not a branch in the job.
- Lock order is always: order row first, then `ticket_types` rows in ascending `code` (spec §4.1, §4.5).
- Test file patterns:
  - unit tests are `src/**/*.spec.ts`, run by `pnpm test` (no Docker);
  - integration tests are `test/**/*.int-spec.ts`, run by `pnpm test:int` (Docker);
  - contract specs live in `packages/contract-tests/src/ticket-service/*.contract.ts`.
- Commits: one per task, conventional, with the message given in the task.

## Review Focus

1. **`BigInt` in a response body.** Prisma returns `price_minor` and `total_minor` as `BigInt`, and `JSON.stringify` throws on them. A naive mapper turns every order response into a 500. Pinned by the contract tests in Tasks 4–5, which validate `priceMinor`/`totalMinor` as integers.
2. **Reusing one transaction for two orders.** Confirming order B with the `transactionId` that already confirmed order A hits `orders_paid_transaction_id_key` (unique violation `23505`). It must return 409 `ORDER_NOT_CONFIRMABLE`, not 500. Test in Task 6.
3. **Bad input reaching the database.** A non-UUID `orderId`, `quantity: "2"`, a duplicate `ticketTypeCode`, an unknown code or a malformed JSON body must each give 400 `VALIDATION_ERROR`, never a 500 from a Postgres cast or a unique violation. Tests in Tasks 3 and 5.
4. **Confirm racing the expiry job.** The same order is confirmed while the job expires it. Afterwards `reserved` must not be double-released or go negative, and `sold` counts each ticket exactly once. Test in Task 7.
5. **Database down.** `/health/live` stays 200 (it never touches the DB). `/health/ready` returns 503 within ~2 s instead of hanging. Test in Task 2.

---

## File Structure

```text
packages/contracts/
  package.json                    + "bundle" script, build runs it; exports "./openapi/*.json" → dist
packages/contract-tests/          NEW — black-box suite, usable against any base URL
  package.json  tsconfig.json  jest.config.cjs  jest.contract.cjs
  src/index.ts                    exports runTicketServiceContract, ContractTarget
  src/validator.ts                ContractValidator: Ajv over the bundled, dereferenced contract
  src/validator.spec.ts           unit tests for the validator
  src/target.ts                   ContractTarget type + targetFromEnv()
  src/ticket-service/suite.ts     runTicketServiceContract(getTarget) — registers every describe block
  src/ticket-service/*.contract.ts  one file per area: health, auth, ticket-types, orders, confirm
  test/ticket-service.contract-spec.ts  runner 2: targetFromEnv() → suite
apps/ticket-service/
  package.json  tsconfig.json  tsconfig.build.json  jest.config.cjs (unit)  jest.int.config.cjs
  .env.example  Dockerfile  prisma.config.ts  prisma/schema.prisma (models added)
  src/main.ts                     bootstrap(): listen, enableShutdownHooks
  src/app.module.ts               createAppModule wiring
  src/config/env.ts               EnvironmentVariables + validateEnv()
  src/common/prisma.service.ts    PrismaService (adapter-pg), onModuleDestroy → $disconnect
  src/common/db-errors.ts         isUniqueViolation(err, constraint)
  src/common/http/correlation-id.ts   correlation middleware + header constant
  src/common/http/api-key.guard.ts    ApiKeyGuard (scopes)
  src/common/http/error-envelope.filter.ts  AllExceptionsFilter → envelope
  src/common/http/validation.ts   createValidationPipe()
  src/common/docs.ts              setupDocs(app) — serves dist/openapi.json at /docs
  src/health/health.controller.ts  /health/live, /health/ready
  src/ticket-types/ticket-types.controller.ts | ticket-types.repository.ts | ticket-type.view.ts
  src/orders/domain/order.ts      priceOrder(), decideConfirmation(), types
  src/orders/domain/errors.ts     DomainError subclasses
  src/orders/orders.repository.ts PrismaOrdersRepository (all SQL for orders)
  src/orders/orders.service.ts    createOrder, getOrder, confirmOrder
  src/orders/order-expiry.job.ts  OrderExpiryJob.runOnce() + interval registration
  src/orders/orders.controller.ts | internal-orders.controller.ts | dto/*.ts | order.view.ts
  test/support/app.ts             startTicketService(db, overrides?) → { baseUrl, app, close }
  test/*.int-spec.ts              schema (exists), prisma-drift, health, reservation, confirm, expiry, contract
infra/docker-compose.yml          + ticket-service service
infra/.env.example                + PUBLIC_API_KEY_TICKET, INTERNAL_API_KEY_TICKET
docs/adr/0016-contract-validation-with-ajv.md
```

Design notes the implementer needs (not up for change in this phase):

- **No repository interface.** There is one Prisma implementation, and integration tests cover it on real Postgres. A port here would add indirection and delete no risk. Services inject the concrete class.
- **No `version` column or optimistic locking.** Spec §4 picked pessimistic row locks plus conditional UPDATEs, and those are the concurrency argument.
- **The domain holds the decisions, SQL holds the counters.** `decideConfirmation` picks the branch. The repository runs that branch's SQL inside the locked transaction.

---

### Task 1: Bundled contract, Ajv validator, contract-tests package, ADR-0016

**Files:**
- Modify: `packages/contracts/package.json`
- Create: `packages/contract-tests/{package.json,tsconfig.json,jest.config.cjs,jest.contract.cjs}`, `src/{index.ts,validator.ts,validator.spec.ts,target.ts}`, `src/ticket-service/suite.ts`, `test/ticket-service.contract-spec.ts`
- Create: `docs/adr/0016-contract-validation-with-ajv.md`
- Modify: `docs/spec.md` §7.1 (new row), §13 (ADR row)

**Interfaces:**
- Produces:
  ```ts
  // @eticket/contracts: file dist/ticket-service.json (bundled + dereferenced), resolvable as
  require.resolve('@eticket/contracts/openapi/ticket-service.json')

  // @eticket/contract-tests
  export interface ContractTarget { baseUrl: string; publicApiKey: string; internalApiKey: string }
  export function targetFromEnv(): ContractTarget  // CONTRACT_BASE_URL, CONTRACT_API_KEY, CONTRACT_INTERNAL_API_KEY; throws naming the missing var
  export type ServiceName = 'ticket-service'
  export class ContractValidator {
    static load(service: ServiceName): ContractValidator
    /** Throws an Error listing Ajv errors if status is undocumented for the operation or the body fails its schema. */
    assertResponse(operationId: string, status: number, body: unknown): void
  }
  export function runTicketServiceContract(getTarget: () => ContractTarget): void
  ```

- [ ] **Step 1: Add the bundle to `@eticket/contracts`.** Script `"bundle": "redocly bundle openapi/ticket-service.yaml --dereferenced --ext json -o dist/ticket-service.json"`. Check the flags with `pnpm exec redocly bundle --help` (Redocly 2). Change `build` to `tsc -p tsconfig.json --noEmit && pnpm bundle`. Add the export `"./openapi/*.json": "./dist/*.json"`.
  Run: `pnpm --filter @eticket/contracts build && node -e "const s=require('./packages/contracts/dist/ticket-service.json');console.log(Object.keys(s.paths).length, JSON.stringify(s).includes('\$ref'))"`
  Expected: `6 false`

- [ ] **Step 2: Create the package.** `@eticket/contract-tests`, private.
  - Dependencies: `ajv@8`, `ajv-formats@3`, `supertest@7`, `@types/supertest`, `@eticket/contracts: workspace:*`.
  - Dev dependencies as in `packages/testing`.
  - Scripts: `lint`, `build` (tsc noEmit), `test` (`jest -c jest.config.cjs`, matches `src/**/*.spec.ts`), `test:contract` (`jest -c jest.contract.cjs`, matches `test/**/*.contract-spec.ts`, `testTimeout` 30000, `maxWorkers` 1).
  - Add `"test:contract": { "cache": false, "dependsOn": ["^build"] }` to `turbo.json`.

- [ ] **Step 3: Write the failing validator tests** in `src/validator.spec.ts`:
  ```ts
  const v = ContractValidator.load('ticket-service');
  const ticketType = { code: 'GOLD', name: 'Gold', priceMinor: 10000, currency: 'AED', quota: 100, sold: 0, reserved: 0, available: 100 };
  it('accepts a valid listTicketTypes 200 body', () =>
    expect(() => v.assertResponse('listTicketTypes', 200, { data: [ticketType] })).not.toThrow());
  it('rejects a missing required field', () =>
    expect(() => v.assertResponse('listTicketTypes', 200, { data: [{ ...ticketType, available: undefined }] })).toThrow(/available/));
  it('rejects a string where an integer is required', () =>
    expect(() => v.assertResponse('listTicketTypes', 200, { data: [{ ...ticketType, priceMinor: '10000' }] })).toThrow(/priceMinor/));
  it('accepts null for nullable confirmedAt', () => /* a full PENDING Order body with confirmedAt: null, paidTransactionId: null */);
  it('rejects a status the operation does not document', () =>
    expect(() => v.assertResponse('getOrder', 500, {})).toThrow(/not documented/));
  it('rejects an error body without correlationId', () =>
    expect(() => v.assertResponse('getOrder', 404, { statusCode: 404, code: 'NOT_FOUND', message: 'x' })).toThrow(/correlationId/));
  it('throws on an unknown operationId', () => expect(() => v.assertResponse('nope', 200, {})).toThrow(/nope/));
  ```
  Run: `pnpm --filter @eticket/contract-tests test` → FAIL (module not found).

- [ ] **Step 4: Implement `ContractValidator`.**
  - Load the bundled JSON via `require.resolve('@eticket/contracts/openapi/<service>.json')`.
  - Index operations by `operationId`.
  - Compile `responses[status].content['application/json'].schema` with `new Ajv({ strict: false, allErrors: true })` plus `addFormats(ajv)`. Ajv 8 understands the OpenAPI 3.0 `nullable` keyword. `strict: false` lets the `example` keyword through.
  - If a response has no JSON content (none in this contract), only the status is checked.
  - The error message includes the operationId, the status and `ajv.errorsText(errors)`.

  Run: `pnpm --filter @eticket/contract-tests test` → PASS (7 tests).

- [ ] **Step 5: Add the suite shell and runner 2.**
  - `runTicketServiceContract(getTarget)` wraps a `describe('ticket-service contract', …)`. Later tasks add one `describe` per area by importing their `*.contract.ts` modules, and each module exports `register(getTarget, validator)`.
  - `getTarget` is a function because runner 1 only knows the URL after `beforeAll`.
  - `test/ticket-service.contract-spec.ts` calls `runTicketServiceContract(targetFromEnv)`.
  - The suite file's header comment must say: *Mutates the target, because it reserves quota and confirms orders. Never point it at production.*

- [ ] **Step 6: Write ADR-0016** (context, decision, alternatives, trade-off):
  - Contract responses are validated by Ajv 8 + ajv-formats against the redocly-bundled, dereferenced contract. So the YAML itself is the oracle for NestJS and for the .NET port.
  - Rejected: hand-written assertions (they restate the contract and can drift), `jest-openapi` (lightly maintained, tied to one response shape).
  - Trade-off: two dev dependencies. Ajv checks shapes, not behavior; the suite's own assertions check behavior.

  Spec changes:
  - Add the §13 row `| [0016](./adr/0016-contract-validation-with-ajv.md) | Contract tests validate responses with Ajv against the bundled contract | Hand-written assertions |`.
  - In §7.1, change the contract-tests row to `` `CONTRACT_BASE_URL`, `CONTRACT_API_KEY`, `CONTRACT_INTERNAL_API_KEY` `` with purpose "Target under test (public and internal-scope keys)".

- [ ] **Step 7: Verify and commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check` → all pass.
  ```bash
  git add packages/contracts packages/contract-tests turbo.json pnpm-lock.yaml docs/adr/0016-contract-validation-with-ajv.md docs/spec.md
  git commit -m "feat(contract-tests): add Ajv contract validator and suite package (ADR-0016)"
  ```

---

### Task 2: Ticket Service skeleton — config, Prisma client, health, logging, test harness

**Files:**
- Modify: `apps/ticket-service/{package.json,tsconfig.json,jest.config.cjs,prisma.config.ts,prisma/schema.prisma}`; `.gitignore` (add `apps/*/src/generated/`)
- Create: `apps/ticket-service/{tsconfig.build.json,jest.int.config.cjs,.env.example}`, `src/main.ts`, `src/app.module.ts`, `src/config/env.ts`, `src/config/env.spec.ts`, `src/common/prisma.service.ts`, `src/common/db-errors.ts`, `src/health/health.controller.ts`, `test/support/app.ts`, `test/prisma-drift.int-spec.ts`, `test/health.int-spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables  // throws Error listing every invalid var
  export class PrismaService extends PrismaClient implements OnModuleDestroy {}
  export function isUniqueViolation(err: unknown, constraint: string): boolean  // Prisma P2002 or raw-query 23505 naming the constraint
  export async function createApp(env: Record<string, string>): Promise<INestApplication>  // src/main.ts; applies every global (pipes, filter, guard, middleware) — used by main and tests
  // test/support/app.ts
  export interface RunningService { baseUrl: string; app: INestApplication; publicKey: string; internalKey: string; close(): Promise<void> }
  export async function startTicketService(db: TestDatabase, overrides?: Record<string, string>): Promise<RunningService>
    // DATABASE_URL = db.urlFor('tickets_app'); fixed 32+ char test keys; ORDER_EXPIRY_ENABLED=false; app.listen(0) on 127.0.0.1
  ```

- [ ] **Step 1: Dependencies and TypeScript.**
  - Dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/config`, `@nestjs/swagger`, `@nestjs/terminus`, `@nestjs/schedule`, `nestjs-pino`, `pino-http`, `class-validator`, `class-transformer`, `reflect-metadata`, `rxjs`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg`.
  - Dev dependencies: `@nestjs/testing`, `supertest`, `@types/supertest`, `@types/pg`, `@eticket/contract-tests: workspace:*`, `@eticket/contracts: workspace:*`.
  - `tsconfig.json`: add `experimentalDecorators`, `emitDecoratorMetadata`, `isolatedModules: false` (`emitDecoratorMetadata` needs value imports), `outDir: dist`, `rootDir: .`, include `src`, `test`, `prisma.config.ts`.
  - `tsconfig.build.json`: extends it, includes `src` only, excludes `**/*.spec.ts`.

- [ ] **Step 2: Prisma client.**
  - Prisma 7 evaluates `prisma.config.ts` even for `generate`, and `env()` throws when the variable is unset. Change the datasource URL to `process.env.MIGRATION_DATABASE_URL ?? ''` so `prisma generate` runs with no env.
  - Add the generator `generator client { provider = "prisma-client"; output = "../src/generated/prisma"; moduleFormat = "cjs" }`. Check the generator field names against the current Prisma 7 docs.
  - Add models `TicketType`, `Order`, `OrderItem` that mirror the migration exactly:
    - `@@map("ticket_types")` and the like;
    - snake_case `@map` on every column;
    - `@db.Uuid`, `@db.Char(3)`, `@db.Timestamptz(6)`, `BigInt` for `*_minor`;
    - relations `OrderItem → Order`, `OrderItem → TicketType`;
    - `@@unique` and `@@index` with the migration's constraint and index names via `map:`.
  - Scripts:
    - `"generate": "prisma generate"`
    - `"build": "prisma generate && tsc -p tsconfig.build.json && node -e \"require('fs').copyFileSync(require.resolve('@eticket/contracts/openapi/ticket-service.json'),'dist/openapi.json')\""`
    - `"lint": "prisma generate && eslint ."`
    - `"test": "prisma generate && jest -c jest.config.cjs"`
    - `"test:int": "prisma generate && jest -c jest.int.config.cjs"`
    - `"start": "node dist/src/main.js"`
  - `jest.config.cjs`: ts-jest, `src/**/*.spec.ts`.
  - `jest.int.config.cjs`: `@eticket/config/jest-integration`.

- [ ] **Step 3: Write the failing drift test** `test/prisma-drift.int-spec.ts`. Start the DB, apply migrations, then run `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` with `MIGRATION_DATABASE_URL=db.urlFor('tickets_owner')`. Confirm the flag names with `pnpm exec prisma migrate diff --help`. Expect exit code 0. Prisma does not model CHECK constraints, so they are out of scope for this diff; `schema.int-spec.ts` already covers them.
  Run: `pnpm --filter @eticket/ticket-service test:int -- prisma-drift` → FAIL until the models match, PASS after.

- [ ] **Step 4: Write the failing env unit tests** `src/config/env.spec.ts`:
  ```ts
  const ok = { DATABASE_URL: 'postgresql://x', PUBLIC_API_KEY_TICKET: 'p'.repeat(32), INTERNAL_API_KEY_TICKET: 'i'.repeat(32) };
  it('applies defaults', () => expect(validateEnv(ok)).toMatchObject({ PORT: 3001, ORDER_TTL_MINUTES: 15, ORDER_EXPIRY_INTERVAL_SECONDS: 60, ORDER_EXPIRY_BATCH_SIZE: 100, ORDER_EXPIRY_ENABLED: true, SWAGGER_ENABLED: false }));
  it('rejects a short key', () => expect(() => validateEnv({ ...ok, PUBLIC_API_KEY_TICKET: 'short' })).toThrow(/PUBLIC_API_KEY_TICKET/));
  it('rejects equal public and internal keys', () => expect(() => validateEnv({ ...ok, INTERNAL_API_KEY_TICKET: ok.PUBLIC_API_KEY_TICKET })).toThrow(/INTERNAL_API_KEY_TICKET/));
  it('rejects a missing DATABASE_URL', () => expect(() => validateEnv({ ...ok, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/));
  it('parses "false" as false', () => expect(validateEnv({ ...ok, ORDER_EXPIRY_ENABLED: 'false' }).ORDER_EXPIRY_ENABLED).toBe(false));
  ```
  Then implement `validateEnv` with `class-transformer` `plainToInstance` and `class-validator` `validateSync`, and wire it into `ConfigModule.forRoot({ validate: validateEnv, isGlobal: true })`. Use `ignoreEnvFile: true`: env comes from the process, so no `.env` file is read.
  Run: `pnpm --filter @eticket/ticket-service test` → PASS.

- [ ] **Step 5: Implement `PrismaService`, `createApp`, health and logging.**
  - `PrismaService` builds `new PrismaPg({ connectionString: DATABASE_URL })`. The `tickets_app` role's `search_path` is already `tickets`.
  - Health:
    - `/health/live` returns `{ status: 'ok' }` with no DB call;
    - `/health/ready` runs `SELECT 1` with a 2 s timeout via `@nestjs/terminus` (a custom `HealthIndicator`, or `PrismaHealthIndicator` with `timeout: 2000`). Up: 200 `{ status: 'ok' }`. Down: 503 `{ status: 'error', details }`. Health bodies are exempt from the error envelope, so the filter must pass Terminus's `ServiceUnavailableException` response through unchanged.
  - `LoggerModule.forRoot`:
    - JSON output; `level` from `LOG_LEVEL`; `customProps` sets `service: 'ticket-service'`;
    - `genReqId` comes from the correlation middleware (Task 3 sets the ID; for now generate a UUID);
    - `redact` covers `req.headers["x-api-key"]` and `req.headers.authorization`.
  - `main.ts` calls `createApp(process.env)`, then `app.enableShutdownHooks()`, then `listen(PORT, '0.0.0.0')`.
  - `.env.example` lists every var from Global Constraints with placeholder values.

- [ ] **Step 6: Write the health integration tests** `test/health.int-spec.ts`, using `startTicketService`:
  ```ts
  it('live is 200 without a key', async () => { const r = await request(s.baseUrl).get('/health/live'); expect(r.status).toBe(200); expect(r.body).toEqual({ status: 'ok' }); });
  it('ready is 200 with the DB up', …status 200, body.status 'ok');
  it('ready is 503 within 3 s when the DB is gone, live stays 200', async () => {
    // separate RunningService whose DATABASE_URL points at a closed port (127.0.0.1:1)
    const t0 = Date.now(); const r = await request(down.baseUrl).get('/health/ready');
    expect(r.status).toBe(503); expect(Date.now() - t0).toBeLessThan(3000);
    expect((await request(down.baseUrl).get('/health/live')).status).toBe(200);
  });
  ```
  The app must start even when the DB is unreachable: do not call `$connect()` at boot, and let Prisma connect lazily.
  Run: `pnpm --filter @eticket/ticket-service test:int` → PASS (schema 10, drift 1, health 3).

- [ ] **Step 7: Commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check` → pass.
  ```bash
  git add apps/ticket-service .gitignore pnpm-lock.yaml
  git commit -m "feat(ticket-service): add NestJS skeleton with config, Prisma client and health probes"
  ```

---

### Task 3: HTTP cross-cutting — error envelope, validation, API-key scopes, correlation ID, /docs

**Files:**
- Create: `src/common/http/{correlation-id.ts,api-key.guard.ts,error-envelope.filter.ts,validation.ts}` and a `*.spec.ts` beside each; `src/orders/domain/errors.ts`; `src/common/docs.ts`
- Create: `packages/contract-tests/src/ticket-service/{health,auth}.contract.ts`; `apps/ticket-service/test/contract.int-spec.ts`
- Modify: `src/main.ts` (`createApp` applies all globals), `docs/spec.md` §2.2

**Interfaces:**
- Consumes: `createApp`, `startTicketService` (Task 2); `ContractValidator`, `runTicketServiceContract` (Task 1).
- Produces:
  ```ts
  export const CORRELATION_HEADER = 'x-correlation-id';
  export function correlationIdOf(req: Request): string
  export abstract class DomainError extends Error { abstract readonly code: string; abstract readonly httpStatus: number }
  export class OrderNotFoundError extends DomainError       // NOT_FOUND 404
  export class QuotaExceededError extends DomainError       // QUOTA_EXCEEDED 409 (message names the ticket type code)
  export class OrderNotConfirmableError extends DomainError // ORDER_NOT_CONFIRMABLE 409
  export const Public = () => SetMetadata(IS_PUBLIC, true)  // marks health and docs routes (no key)
  ```
- Filter mapping:
  - `DomainError` → its status and code;
  - `BadRequestException` (pipes, malformed JSON) → 400 `VALIDATION_ERROR`, with `message` joining the validator messages;
  - `UnauthorizedException` → `UNAUTHORIZED`;
  - `ForbiddenException` → `FORBIDDEN`;
  - `NotFoundException` (unknown route) → `NOT_FOUND`;
  - anything else → 500 `INTERNAL_ERROR`, logged with its stack, with a generic message (no internals leak).

- [ ] **Step 1: Write the failing unit tests.**
  - The guard spec builds an `ExecutionContext` stub with a path and headers. It asserts:
    - no key → `UnauthorizedException`;
    - wrong key → `UnauthorizedException`;
    - a wrong key of different length does not throw a `RangeError`;
    - public key on `/v1/orders` → allowed;
    - public key on `/v1/internal/orders/x/confirm` → `ForbiddenException`;
    - internal key on both routes → allowed;
    - a `@Public()` handler → allowed with no key.
  - The filter spec asserts each mapping row above produces `{ statusCode, code, message, correlationId }`, with `correlationId` equal to the request's ID.
  - The correlation spec asserts:
    - a UUID header is kept;
    - `'not-a-uuid'` is replaced with a fresh UUID v4;
    - a missing header gets a new UUID;
    - the response header is set.

  Run: `pnpm --filter @eticket/ticket-service test` → FAIL.

- [ ] **Step 2: Implement the four pieces and register them globally in `createApp`.**
  - The guard is an `APP_GUARD`.
  - The filter goes through `app.useGlobalFilters`.
  - The pipe comes from `createValidationPipe()`.
  - The middleware runs first, and `nestjs-pino` `genReqId` reads its value.
  - The guard decides scope by path prefix `/v1/internal/`.
  - Keys come from `ConfigService`, never `process.env` at call time.

  Run the unit tests → PASS.

- [ ] **Step 3: `/docs`.** `setupDocs(app)` reads `dist/openapi.json` (in tests, resolve `@eticket/contracts/openapi/ticket-service.json`) and calls `SwaggerModule.setup('docs', app, document)`. It does this only when `SWAGGER_ENABLED` is true, and the docs routes are public.

- [ ] **Step 4: Write the health and auth contract specs.**
  - In `health.contract.ts`:
    - live returns 200 matching `healthLive`, sent with no key;
    - ready returns 200 matching `healthReady`.
  - In `auth.contract.ts`, each case uses `validator.assertResponse('listTicketTypes' | 'confirmOrder', status, body)` and checks `body.code`:
    - `GET /v1/ticket-types` with no key → 401 `UNAUTHORIZED`;
    - with key `'x'.repeat(40)` → 401;
    - with the public key on `POST /v1/internal/orders/<random uuid>/confirm` and body `{ transactionId: <uuid> }` → 403 `FORBIDDEN`;
    - an unknown route `/v1/nope` with the public key → 404 `NOT_FOUND` with a `correlationId`. There is no operationId for this, so assert the envelope fields directly;
    - an error request sent with `X-Correlation-Id: <uuid>` returns `body.correlationId` equal to that UUID and the same response header.

  Register both in `suite.ts`. Runner 1 is `test/contract.int-spec.ts`: `beforeAll` starts the DB, applies migrations and runs `startTicketService`; then `runTicketServiceContract(() => ({ baseUrl, publicApiKey, internalApiKey }))`; `afterAll` closes everything.
  Run: `pnpm --filter @eticket/ticket-service test:int` → PASS.

- [ ] **Step 5: Spec §2.2.** Change the internal-scope bullet to: "**internal scope** — held only by the Payment Service; required on `/v1/internal/*` and also accepted on the public routes it calls (`GET /v1/orders/{orderId}`)."

- [ ] **Step 6: Commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check` → pass.
  ```bash
  git add apps/ticket-service packages/contract-tests docs/spec.md
  git commit -m "feat(ticket-service): add error envelope, validation, scoped API keys and correlation ID"
  ```

---

### Task 4: Ticket types read

**Files:**
- Create: `src/ticket-types/{ticket-types.repository.ts,ticket-types.controller.ts,ticket-type.view.ts,ticket-type.view.spec.ts}`, `src/common/money.ts` + `money.spec.ts`
- Create: `packages/contract-tests/src/ticket-service/ticket-types.contract.ts`

**Interfaces:**
- Produces:
  ```ts
  export function toMinor(value: bigint): number            // throws RangeError if not a safe integer
  export interface TicketTypeView { code: 'GOLD'|'PREMIUM'|'VIP'; name: string; priceMinor: number; currency: string; quota: number; sold: number; reserved: number; available: number }
  export class TicketTypesRepository { list(): Promise<TicketTypeView[]> }  // ordered by code ASC
  ```

- [ ] **Step 1: Write the failing tests.**
  - `money.spec.ts`:
    - `toMinor(10000n) === 10000`;
    - `toMinor(2n ** 60n)` throws `RangeError`.
  - `ticket-type.view.spec.ts`: `available = quota - sold - reserved`.
  - `ticket-types.contract.ts`, with the public key:
    - `GET /v1/ticket-types` → 200, `assertResponse('listTicketTypes', 200, body)`;
    - `body.data.map(t => t.code)` equals `['GOLD','PREMIUM','VIP']`;
    - prices `[10000, 20000, 50000]`;
    - every `currency === 'AED'` and `quota === 100`;
    - for every row `available === quota - sold - reserved`. Do not assert `sold`/`reserved` are 0, because other contract tests mutate them.

  Run: unit tests and `test:int` → FAIL.

- [ ] **Step 2: Implement** the repository (Prisma `ticketType.findMany({ orderBy: { code: 'asc' } })`), the mapper and the controller (`GET /v1/ticket-types` → `{ data }`).
  Run: unit tests and `test:int` → PASS.

- [ ] **Step 3: Commit.**
  ```bash
  git add apps/ticket-service packages/contract-tests
  git commit -m "feat(ticket-service): list ticket types with live availability"
  ```

---

### Task 5: Create and read orders with atomic reservation

**Files:**
- Create: `src/orders/domain/order.ts` + `order.spec.ts`, `src/orders/orders.repository.ts`, `src/orders/orders.service.ts`, `src/orders/orders.controller.ts`, `src/orders/dto/create-order.dto.ts`, `src/orders/order.view.ts`
- Create: `test/reservation.int-spec.ts`; `packages/contract-tests/src/ticket-service/orders.contract.ts`

**Interfaces:**
- Consumes: `toMinor` (Task 4), `QuotaExceededError` and `OrderNotFoundError` (Task 3).
- Produces:
  ```ts
  export type TicketTypeCode = 'GOLD' | 'PREMIUM' | 'VIP';
  export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'EXPIRED';
  export interface OrderLineRequest { ticketTypeCode: TicketTypeCode; quantity: number }
  export interface PricedLine { ticketTypeCode: TicketTypeCode; ticketTypeId: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }
  export function sortLines<T extends { ticketTypeCode: TicketTypeCode }>(lines: T[]): T[]   // ascending code, new array
  export function priceOrder(lines: PricedLine[]): { lines: PricedLine[]; totalMinor: number } // throws if a line's total != unit*qty or currency mixes
  export interface OrderView { id: string; status: OrderStatus; items: Array<{ ticketTypeCode: TicketTypeCode; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>; totalMinor: number; currency: string; createdAt: string; expiresAt: string; confirmedAt: string | null; paidTransactionId: string | null }
  export class OrdersRepository {
    reserveAndCreate(lines: OrderLineRequest[], ttlMinutes: number): Promise<OrderView>   // one $transaction; throws QuotaExceededError
    findById(id: string): Promise<OrderView | null>
  }
  export class OrdersService { createOrder(lines: OrderLineRequest[]): Promise<OrderView>; getOrder(id: string): Promise<OrderView> }
  ```
- `reserveAndCreate` runs, in one interactive `$transaction`, for each line in `sortLines` order:
  ```sql
  UPDATE tickets.ticket_types SET reserved = reserved + ${qty}
   WHERE code = ${code} AND sold + reserved + ${qty} <= quota
  RETURNING id, price_minor, currency
  ```
  - Zero rows → throw `QuotaExceededError(code)`, which rolls back the whole transaction.
  - Then insert the order (`PENDING`, `expires_at = now() + make_interval(mins => ${ttl})`, server `total_minor`) and its items.
  - Re-read and map it.
  - Times come from the database clock (`now()`), never `new Date()`, so `expires_at` and the expiry job share one clock.

- [ ] **Step 0: Fix a contract gap.** `getOrder` in `packages/contracts/openapi/ticket-service.yaml` documents no `400`, yet a non-UUID `orderId` must return 400 `VALIDATION_ERROR` (spec §6). Add `'400': { $ref: './common.yaml#/components/responses/ValidationError' }` to `getOrder` responses. This is additive and non-breaking, so there is no version bump. Then run `pnpm --filter @eticket/contracts lint && pnpm --filter @eticket/contracts generate && pnpm --filter @eticket/contracts build`, and commit the regenerated `src/generated/ticket-service.ts` with this task.

- [ ] **Step 1: Write the failing domain tests** in `order.spec.ts`:
  - `sortLines` with VIP, GOLD, PREMIUM → GOLD, PREMIUM, VIP, and the input is not mutated;
  - `priceOrder` with GOLD×2 @10000 and VIP×1 @50000 → `totalMinor` 70000;
  - a line whose `lineTotalMinor` ≠ unit×qty throws.

- [ ] **Step 2: Write the DTO.**
  - `items` is `@IsArray @ArrayMinSize(1) @ArrayMaxSize(3) @ValidateNested({ each: true }) @Type(() => OrderLineDto)`.
  - It has a custom `@ArrayUnique(i => i.ticketTypeCode)` with the message "each ticketTypeCode may appear at most once".
  - `ticketTypeCode` is `@IsIn(['GOLD','PREMIUM','VIP'])`.
  - `quantity` is `@IsInt @Min(1) @Max(10)`.

- [ ] **Step 3: Write the failing contract specs** `orders.contract.ts`, each body checked with `assertResponse('createOrder' | 'getOrder', …)`:
  - `POST /v1/orders` with GOLD×2 and VIP×1 → 201:
    - `status` is `'PENDING'`, `totalMinor` 70000, `currency` 'AED';
    - the items, compared as a set by code, carry GOLD 10000/20000 and VIP 50000/50000;
    - `confirmedAt` and `paidTransactionId` are null;
    - `Date.parse(expiresAt) - Date.parse(createdAt)` is within 15 min ± 5 s. The TTL comes from `CONTRACT_ORDER_TTL_MINUTES` with default 15; read it in `target.ts` as an optional field `orderTtlMinutes`.
  - The reservation is visible: GOLD `available` drops by exactly 2 and VIP by 1, compared with a read taken just before.
  - `GET /v1/orders/{id}` → 200 and equals the create body.
  - `GET` with an unknown UUID → 404 `NOT_FOUND`. `GET /v1/orders/not-a-uuid` → 400 `VALIDATION_ERROR`.
  - Each of these bodies → 400 `VALIDATION_ERROR`, a table-driven `it.each`:
    - `{}`
    - `{ items: [] }`
    - four items
    - `quantity: 0`
    - `quantity: 11`
    - `quantity: '2'`
    - `quantity: 1.5`
    - `ticketTypeCode: 'BRONZE'`
    - a duplicate `GOLD`
    - an extra top-level field `totalMinor: 1`
    - an extra item field `unitPriceMinor: 1`
  - A malformed JSON body (`'{"items":'` sent as `application/json`) → 400 `VALIDATION_ERROR`.
  - Quota edge and all-or-nothing. Put this test **last** in the suite because it drains VIP.
    1. Read VIP `available = n`.
    2. Create VIP×10 orders while `n >= 10`, then one VIP×`n` if `n > 0`, so VIP `available` is 0.
    3. `POST` GOLD×1 + VIP×1 → 409 `QUOTA_EXCEEDED`.
    4. GOLD `available` is unchanged, which shows the GOLD reservation was rolled back.

- [ ] **Step 4: Write the failing integration tests** `test/reservation.int-spec.ts`. These call `OrdersService` from `app.get(OrdersService)`, on a fresh DB per `describe`.
  - *Never oversells across types under concurrency.*
    1. Set GOLD and VIP to `quota = 5`, `sold = 0`, `reserved = 0` with a `postgres` client.
    2. Fire 12 concurrent `createOrder([{GOLD,1},{VIP,1}])` and 12 concurrent `createOrder([{VIP,1},{GOLD,1}])`. The reversed input order exercises the lock-order sort.
    3. Assert exactly 5 fulfilled and 19 rejected with `QuotaExceededError`, with no other error type: no deadlock `40P01`, no 500.
    4. Assert `reserved` is 5 for both types.
  - *Total is server-computed.* Set GOLD `price_minor = 12345` via SQL, then create GOLD×3. Assert `totalMinor` 37035 and the `order_items.unit_price_minor` row is 12345.

  Run: `pnpm --filter @eticket/ticket-service test && pnpm --filter @eticket/ticket-service test:int` → FAIL.

- [ ] **Step 5: Implement** the domain, repository, service and controller.
  - `POST /v1/orders` → 201.
  - `GET /v1/orders/:orderId` with `ParseUUIDPipe` → 200, or `OrderNotFoundError`.
  - The repository maps rows to `OrderView`. Items go in code order. Dates use `toISOString()`. Minor units go through `toMinor`.

  Run the unit tests and `test:int` → PASS.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/ticket-service packages/contract-tests packages/contracts
  git commit -m "feat(ticket-service): create server-priced orders with atomic quota reservation"
  ```

---

### Task 6: Confirm order (internal, idempotent, expired-but-paid policy)

**Files:**
- Modify: `src/orders/domain/order.ts` + `order.spec.ts`, `src/orders/orders.repository.ts`, `src/orders/orders.service.ts`
- Create: `src/orders/internal-orders.controller.ts`, `src/orders/dto/confirm-order.dto.ts`, `test/confirm.int-spec.ts`, `packages/contract-tests/src/ticket-service/confirm.contract.ts`

**Interfaces:**
- Consumes: `OrdersRepository`, `OrderView` (Task 5); `OrderNotConfirmableError`, `OrderNotFoundError`, `isUniqueViolation`.
- Produces:
  ```ts
  export type ConfirmationDecision = 'REPLAY' | 'CONFIRM_PENDING' | 'CONFIRM_EXPIRED' | 'REJECT';
  export function decideConfirmation(order: { status: OrderStatus; paidTransactionId: string | null }, transactionId: string): ConfirmationDecision
  // OrdersRepository
  confirm(orderId: string, transactionId: string): Promise<OrderView>  // throws OrderNotFoundError | OrderNotConfirmableError
  // OrdersService
  confirmOrder(orderId: string, transactionId: string): Promise<OrderView>
  ```
- `confirm` runs in one `$transaction`:
  1. `SELECT id, status, paid_transaction_id FROM tickets.orders WHERE id = ${id} FOR UPDATE`. This lock blocks; zero rows → `OrderNotFoundError`.
  2. Load the items joined to their codes, sorted by code.
  3. Switch on `decideConfirmation`:
     - `REPLAY` → return the current view.
     - `REJECT` → `OrderNotConfirmableError`.
     - `CONFIRM_PENDING` → per item, in code order, `UPDATE ticket_types SET reserved = reserved - ${qty}, sold = sold + ${qty} WHERE id = ${ticketTypeId}`.
     - `CONFIRM_EXPIRED` → per item, in code order, `UPDATE ticket_types SET sold = sold + ${qty} WHERE id = ${ticketTypeId} AND sold + reserved + ${qty} <= quota RETURNING id`. Zero rows → `OrderNotConfirmableError`, which rolls everything back.
  4. Then `UPDATE orders SET status = 'CONFIRMED', confirmed_at = now(), paid_transaction_id = ${txn}`.
  5. A unique violation on `orders_paid_transaction_id_key` anywhere in this flow → `OrderNotConfirmableError`.

- [ ] **Step 1: Write the failing domain tests** in `order.spec.ts`:
  - `decideConfirmation({ status: 'PENDING', paidTransactionId: null }, T)` → `CONFIRM_PENDING`;
  - `EXPIRED` → `CONFIRM_EXPIRED`;
  - `CONFIRMED` with `paidTransactionId` T → `REPLAY`;
  - `CONFIRMED` with another transaction ID U → `REJECT`.

- [ ] **Step 2: Write the failing contract specs** `confirm.contract.ts`. They use the **internal** key unless stated, and bodies go through `assertResponse('confirmOrder', …)`.
  - Create GOLD×2, read GOLD `sold`/`reserved`, then confirm with transaction T → 200:
    - `status` is `'CONFIRMED'`, `paidTransactionId === T`, `confirmedAt` is not null;
    - GOLD `sold` is +2 and `reserved` is −2.
  - Confirm again with T → 200, and the body deep-equals the first response.
  - Confirm with U → 409 `ORDER_NOT_CONFIRMABLE`.
  - Create another order and confirm it with T, which is already used → 409 `ORDER_NOT_CONFIRMABLE`.
  - Confirm an unknown order UUID → 404 `NOT_FOUND`.
  - Body `{}`, `{ transactionId: 'x' }` or `{ transactionId: T, extra: 1 }` → 400 `VALIDATION_ERROR`.
  - `GET /v1/orders/{id}` with the internal key → 200, because the internal scope is accepted on public routes.

  Register the file in `suite.ts` **before** the quota-drain test.

- [ ] **Step 3: Write the failing integration tests** `test/confirm.int-spec.ts`. They call `OrdersService` directly and use SQL as `postgres` to set up state.
  - *Expired order is honored when quota allows.*
    1. Create GOLD×2.
    2. Run `UPDATE orders SET status='EXPIRED'` and `ticket_types SET reserved = reserved - 2`, the same as the expiry job would.
    3. Confirm → `CONFIRMED`, GOLD `sold` is +2 and `reserved` is unchanged.
  - *Expired order is refused when quota is gone, all or nothing.*
    1. Create GOLD×1 + VIP×1 and expire it as above.
    2. Set VIP `sold = quota`.
    3. Confirm → `OrderNotConfirmableError`.
    4. The order is still `EXPIRED` and GOLD `sold` is unchanged.
  - *Concurrent confirms with the same transaction ID.* Run 5 in parallel on one PENDING order. All 5 resolve to `CONFIRMED`, and `sold` rises by the quantity exactly once.

  Run → FAIL.

- [ ] **Step 4: Implement** `POST /v1/internal/orders/:orderId/confirm` (`ParseUUIDPipe`, body DTO `transactionId` `@IsUUID('4')`, 200 via `@HttpCode(200)`), the service and the repository.
  Run the unit tests and `test:int` → PASS.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/ticket-service packages/contract-tests
  git commit -m "feat(ticket-service): confirm paid orders idempotently, honoring expired orders when quota allows"
  ```

---

### Task 7: Order expiry job

**Files:**
- Create: `src/orders/order-expiry.job.ts`, `test/expiry.int-spec.ts`
- Modify: `src/orders/orders.repository.ts`, the orders module wiring

**Interfaces:**
- Consumes: `OrdersRepository.confirm` (Task 6).
- Produces:
  ```ts
  // OrdersRepository
  expireOne(): Promise<string | null>   // one $transaction; returns the expired order id or null if none due
  // OrderExpiryJob
  runOnce(): Promise<number>            // loops expireOne() up to ORDER_EXPIRY_BATCH_SIZE; returns how many expired
  ```
- `expireOne` runs in one `$transaction`:
  1. ```sql
     SELECT id FROM tickets.orders
      WHERE status = 'PENDING' AND expires_at < now()
      ORDER BY expires_at
      FOR UPDATE SKIP LOCKED LIMIT 1
     ```
  2. `UPDATE orders SET status='EXPIRED' WHERE id = ${id} AND status = 'PENDING'`. If no row changed, return null.
  3. Per item, in code order, `UPDATE ticket_types SET reserved = reserved - ${qty} WHERE id = ${ticketTypeId}`.
- Registration:
  - When `ORDER_EXPIRY_ENABLED` is true, the module registers `runOnce` with `SchedulerRegistry.addInterval('order-expiry', setInterval(…, ORDER_EXPIRY_INTERVAL_SECONDS * 1000))` in `onModuleInit`.
  - A run is skipped while the previous one is still running (an in-memory flag).
  - Errors are logged with the correlation ID `job:order-expiry` and never crash the process.
  - `onModuleDestroy` clears the interval.

- [ ] **Step 1: Write the failing integration tests** `test/expiry.int-spec.ts`. The service is started with `ORDER_EXPIRY_ENABLED=false`, and the job comes from `app.get(OrderExpiryJob)`.
  - *Releases expired reservations.*
    1. Create GOLD×3.
    2. `UPDATE orders SET expires_at = now() - interval '1 minute'`.
    3. `runOnce()` → 1. The order is `EXPIRED` and GOLD `reserved` is −3.
    4. A second `runOnce()` → 0, with no double release.
  - *Leaves unexpired and confirmed orders alone.* A fresh PENDING order and a CONFIRMED order with a past `expires_at` are both untouched, and `runOnce()` → 0.
  - *Batch size.* Create 3 due orders and set `ORDER_EXPIRY_BATCH_SIZE=2` (a separate service instance). `runOnce()` → 2, then → 1.
  - *Confirm racing expiry (Review Focus 4).*
    1. Set GOLD `quota = 100`, `sold = 0`, `reserved = 0`.
    2. Create 20 GOLD×1 orders, all made due.
    3. `Promise.all` of `runOnce()` and the 20 `confirmOrder(id, randomUUID())` calls, interleaved.
    4. Afterwards every order is `CONFIRMED` (an expired one is honored because quota allows), GOLD `reserved === 0` and `sold === 20`.
    5. No call rejected with anything other than `OrderNotConfirmableError`, and there were none of those.

  Run → FAIL.

- [ ] **Step 2: Implement** `expireOne`, `OrderExpiryJob` and the registration.
  Run: `pnpm --filter @eticket/ticket-service test:int` → PASS.

- [ ] **Step 3: Commit.**
  ```bash
  git add apps/ticket-service
  git commit -m "feat(ticket-service): expire unpaid orders and release reservations with SKIP LOCKED"
  ```

---

### Task 8: Container, compose service, standalone contract run, docs, phase gate

**Files:**
- Create: `apps/ticket-service/Dockerfile`, `.dockerignore` (repo root, if absent: `node_modules`, `**/dist`, `.turbo`, `**/.env`)
- Modify: `infra/docker-compose.yml`, `infra/.env.example`, `AGENTS.md` (Commands), `packages/contract-tests/README.md` (new), `packages/contracts/README.md` (bundle line)

- [ ] **Step 1: Dockerfile**, multi-stage on `node:26-alpine`, build context at the repo root.
  - Build stage:
    1. `corepack enable`
    2. Copy the workspace manifests and the lockfile.
    3. `pnpm install --frozen-lockfile --filter @eticket/ticket-service...`
    4. Copy the sources.
    5. `pnpm --filter @eticket/ticket-service... build`
    6. `pnpm --filter @eticket/ticket-service deploy --prod --legacy /out`. Check the `deploy` flags for pnpm 10, then copy `dist` into `/out`.
  - Runtime stage:
    - copy `/out`, run as `USER node`, set `ENV NODE_ENV=production`, `EXPOSE 3001`;
    - `HEALTHCHECK` uses `wget -qO- http://127.0.0.1:3001/health/live`;
    - `CMD ["node","dist/src/main.js"]`.

  The image must build for `linux/arm64` too (Phase 9). Avoid native modules.
  Run: `docker build -f apps/ticket-service/Dockerfile -t eticket/ticket-service:dev .` → succeeds.

- [ ] **Step 2: Compose service `ticket-service`.**
  - `build` with context `..` and dockerfile `apps/ticket-service/Dockerfile`.
  - `depends_on`: `postgres` with `service_healthy`, and `migrate-tickets` with `service_completed_successfully`.
  - Environment:
    - `PORT: 3001`
    - `DATABASE_URL: postgresql://tickets_app:${TICKETS_APP_PASSWORD:?set TICKETS_APP_PASSWORD in infra/.env}@postgres:5432/eticketing?schema=tickets`
    - `PUBLIC_API_KEY_TICKET: ${PUBLIC_API_KEY_TICKET:?…}`
    - `INTERNAL_API_KEY_TICKET: ${INTERNAL_API_KEY_TICKET:?…}`
    - `SWAGGER_ENABLED: 'true'`
    - `LOG_LEVEL: info`
  - `ports: ['127.0.0.1:3001:3001']`. This is local only; services are not public (spec §6).
  - A healthcheck on `/health/ready`.
  - Add `PUBLIC_API_KEY_TICKET` and `INTERNAL_API_KEY_TICKET` to `infra/.env.example`, with the comment "≥ 32 chars, different from each other; generate with `openssl rand -hex 32`" and placeholder values of 32+ chars. They must not be real keys.

- [ ] **Step 3: Standalone run against compose.** This needs a real `infra/.env`. If it is missing, create it only by `cp infra/.env.example infra/.env`, and never print it.
  ```bash
  docker compose -f infra/docker-compose.yml up -d --build --wait ticket-service
  set -a; . infra/.env; set +a   # loads keys into this shell only; do not echo them
  CONTRACT_BASE_URL=http://127.0.0.1:3001 CONTRACT_API_KEY="$PUBLIC_API_KEY_TICKET" \
    CONTRACT_INTERNAL_API_KEY="$INTERNAL_API_KEY_TICKET" pnpm --filter @eticket/contract-tests test:contract
  curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/docs/
  docker compose -f infra/docker-compose.yml logs ticket-service | tail -5
  docker compose -f infra/docker-compose.yml down -v
  ```
  Expected:
  - the contract suite passes with the same test count as runner 1;
  - `/docs/` returns `200`;
  - the log lines are JSON with `service`, `correlationId` and `statusCode`, and no `x-api-key` value appears.

- [ ] **Step 4: Docs.**
  - `packages/contract-tests/README.md` covers:
    - what the suite checks;
    - the two runners;
    - the env vars `CONTRACT_BASE_URL`, `CONTRACT_API_KEY`, `CONTRACT_INTERNAL_API_KEY` and optional `CONTRACT_ORDER_TTL_MINUTES`;
    - "mutates the target: reserves quota, confirms orders, drains VIP".
  - Under AGENTS.md Commands, add:
    - `- Ticket Service only: pnpm --filter @eticket/ticket-service test | test:int`
    - `- Contract suite against a running target: CONTRACT_BASE_URL=… CONTRACT_API_KEY=… CONTRACT_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract`
  - Add the bundle command to the contracts README Commands list.

- [ ] **Step 5: Phase gate**, from a clean state.
  ```bash
  docker compose -f infra/docker-compose.yml down -v
  pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check
  infra/scripts/verify-db.sh && docker compose -f infra/docker-compose.yml down -v
  ```
  Expected:
  - every command passes;
  - `test:int` reports the Phase 1 total (34), plus the ticket-service drift, health, reservation, confirm, expiry and contract runner-1 tests;
  - `verify-db.sh` prints `DB OK`.

- [ ] **Step 6: Commit.**
  ```bash
  git add apps/ticket-service/Dockerfile .dockerignore infra AGENTS.md packages/contract-tests/README.md packages/contracts/README.md
  git commit -m "feat(infra): containerize ticket-service and run the contract suite against compose"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-13-phase-2-ticket-service.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task, and a reviewer checks it before the next one starts. This costs Claude tokens per task and per review.

**B — OpenCode hand-off (saves Claude tokens).** You are already on `phase-2-ticket-service`. From the repo root:

```bash
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-13-phase-2-ticket-service.md. \
You are on branch phase-2-ticket-service; do not switch or create branches. Execute the plan's \
tasks 1 to 8 in order. For each task follow every step exactly, write the failing test before the \
code, run every Run command and compare with Expected, and make the commit given in the task. \
Do not edit the SQL migrations. Edit packages/contracts/openapi only where Task 5 Step 0 says so, \
and docs/spec.md only where Tasks 1 and 3 say so. Never run 'prisma migrate dev'. Never print infra/.env; create it only by copying \
infra/.env.example. Pin exact dependency versions. Check current docs for Prisma 7, Redocly 2 and \
pnpm deploy flags before using them. If a verification still fails after two fix attempts, stop and \
report the task, the command and its full output; never skip or weaken a test. Finish by printing \
each task's commit hash and the full Task 8 phase-gate output."
```

To choose the OpenCode model, add `-m <provider/model>`. The same prompt also works pasted into an interactive OpenCode session.

**After either option**, back in Claude Code (Opus): a fresh Sonnet 5.5 agent re-runs the phase gate and the standalone contract run from a clean state. Then come superpowers:requesting-code-review on `phase-2-ticket-service`, the EGM drift check against spec §2.2, §4.1, §4.5, §6 and §7, and the phase summary.
