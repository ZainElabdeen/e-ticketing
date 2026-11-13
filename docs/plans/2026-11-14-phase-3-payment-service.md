# Phase 3 — Payment Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable NestJS Payment Service that:

- creates card and QR payments idempotently, with at most one live payment per order;
- marks QR payments successful on the server;
- records every success as a transaction plus an outbox event in one DB transaction;
- delivers each event with an outbox worker (confirm the order first, then post to the ledger);
- lists transactions for the backoffice;
- passes a black-box payment contract suite.

The NestJS plumbing the Ticket Service already has moves into a shared package that both services use.

**Architecture:** Layers per AGENTS.md: controller → application service → domain → repository.

- **Shared package.** The new `packages/nest-common` holds every piece of NestJS plumbing that is not specific to one service: correlation ID, error envelope, validation pipe, API-key guard, fallback route, pino options, docs, app configuration, DB-error and money helpers. The Ticket Service is switched to it first, and its existing tests prove nothing changed.
- **Payment domain is plain TypeScript, unit-tested with `new`:** Luhn, card expiry, request hash, payment reference, handler registry, retry backoff.
- **Payment methods** follow the Strategy pattern from ADR-0008: `CardHandler` and `QrHandler` are registered in a multi-provider registry.
- **Repositories** use Prisma Client 7 with `$queryRaw` inside interactive transactions. The locking statements are the idempotency key insert, the `FOR UPDATE SKIP LOCKED` claims, and the conditional UPDATEs.
- **Outbound HTTP** to the Ticket Service and the Ledger goes through `@nestjs/axios`, with a 5 s timeout and typed clients.
- **Tests:**
  - integration tests use Testcontainers Postgres plus in-test **stub HTTP servers** for the Ticket Service and the Ledger;
  - the payment contract area is added to `packages/contract-tests`, with two runners like Phase 2.

**Tech Stack:** Node 26, NestJS 11.2.10 (CommonJS, ADR-0017), Prisma 7.10.1 + `@prisma/adapter-pg`, `@nestjs/axios` + `axios` (new, ADR-0019), `@nestjs/schedule`, `@nestjs/terminus`, `nestjs-pino`, `class-validator`, Jest 30 + ts-jest, Supertest, Ajv 8, Testcontainers 11.

**Spec:** [docs/spec.md](../spec.md):

- §2.2: keys, correlation.
- §3.2: payments schema.
- §4.2: payment initiation and idempotency.
- §4.3: success bookkeeping.
- §4.4: outbox worker.
- §6: API conventions.
- §7 and §7.1: cross-cutting rules and env vars.
- §8: testing, race tests.

Wire shapes: [payment-service.yaml](../../packages/contracts/openapi/payment-service.yaml), [ledger-service.yaml](../../packages/contracts/openapi/ledger-service.yaml) (`createPosting`), [ticket-service.yaml](../../packages/contracts/openapi/ticket-service.yaml) (`getOrder`, `confirmOrder`), and [payment-succeeded.schema.json](../../packages/contracts/events/payment-succeeded.schema.json).

ADRs: 0005, 0006, 0008, 0010, 0017, 0018.

**Branch:** `phase-3-payment-service` (already created from `dev`). Do not switch branches.

**Decisions taken for this plan (2026-11-14, by the user):**

- Extract a shared `packages/nest-common`.
- `@nestjs/axios` for outbound HTTP (ADR-0019, Task 4).
- Stub HTTP servers for the downstream services in tests.
- A payment contract suite in the same `contract-tests` package.

## Global Constraints

- **Carried over from Phases 1–2:**
  - Node 26.
  - Exact pinned versions (no `^`/`~`); resolve each major with `npm view <pkg>@<major> version`.
  - `@eticket/*` scope.
  - Never run `prisma migrate dev`. Never read or print `infra/.env`. The throwaway test password is `test-password`.
  - All `@nestjs/*` core packages stay on `11.2.10`. `prisma`, `@prisma/client` and `@prisma/adapter-pg` stay on `7.10.1`.
- The SQL migrations in `apps/*/prisma/migrations/` are **not edited**. If a Prisma model disagrees with the SQL, fix the model.
- **Routes:**
  - `POST /v1/payments`
  - `GET /v1/payments/{paymentId}`
  - `POST /v1/payments/{paymentId}/cancel`
  - `GET /v1/transactions?page&pageSize`
  - `GET /health/live` and `GET /health/ready`
  - `GET /docs` (only when `SWAGGER_ENABLED=true`)

  The Payment Service has **no** `/v1/internal/*` routes.
- **Error envelope** on every non-2xx except the two health probes: `{ statusCode, code, message, correlationId }`. Codes this service uses:

  | Code | Status |
  | --- | --- |
  | `VALIDATION_ERROR` | 400 (also a missing, short or long `Idempotency-Key`) |
  | `UNAUTHORIZED` | 401 |
  | `NOT_FOUND` | 404 (unknown payment, unknown route) |
  | `ORDER_NOT_FOUND` | 404 |
  | `ORDER_NOT_PAYABLE` | 409 |
  | `PAYMENT_IN_PROGRESS` | 409 |
  | `ORDER_ALREADY_PAID` | 409 |
  | `PAYMENT_NOT_CANCELLABLE` | 409 |
  | `INVALID_CARD` | 422 |
  | `IDEMPOTENCY_KEY_REUSE` | 422 |
  | `UPSTREAM_UNAVAILABLE` | 502 |
  | `UPSTREAM_TIMEOUT` | 504 |
  | `INTERNAL_ERROR` | 500 |

  Plus the generic client-error codes from spec §6.
- **API keys.** Inbound: only `PUBLIC_API_KEY_PAYMENT` is accepted; it has no internal scope. Outbound:
  - `INTERNAL_API_KEY_TICKET` is sent on both Ticket Service calls (`GET /v1/orders/{id}` and confirm, ADR-0018);
  - `INTERNAL_API_KEY_LEDGER` is sent on `POST /v1/internal/postings`.
  - Every outbound call carries `X-Correlation-Id`.
- **Card data.** The PAN and CVC never reach the DB, the logs, the request hash or any error message; only `card_last4` is stored. `pino` redaction must cover `req.body.card.number` and `req.body.card.cvc`, even though request bodies are not logged today.
- **Money.** `amount_minor` is `bigint` in Postgres and a JS `number` in the domain and in JSON, converted with `toMinor` from `@eticket/nest-common`. The amount always comes from the Ticket Service order (`totalMinor`), never from the client.
- **Times.**
  - DB timestamps (`created_at`, `succeeded_at`, `cancelled_at`, `succeed_after`, `next_attempt_at`) come from Postgres `now()`.
  - The application clock is used only for the card-expiry check and for the `PAY-<yyyymmdd>` date. Both are UTC and come from an injectable `Clock`, so tests can fix them.
- **Env vars** (validated at boot; the process exits non-zero on any failure):

  | Variable | Rule | Default |
  | --- | --- | --- |
  | `PORT` | int 1–65535 | `3002` |
  | `DATABASE_URL` | required; must contain `?schema=payments` | — |
  | `PUBLIC_API_KEY_PAYMENT` | required, ≥ 32 chars | — |
  | `TICKET_SERVICE_URL` | required URL | — |
  | `LEDGER_SERVICE_URL` | required URL | — |
  | `INTERNAL_API_KEY_TICKET` | required, ≥ 32 chars | — |
  | `INTERNAL_API_KEY_LEDGER` | required, ≥ 32 chars | — |
  | `DOWNSTREAM_TIMEOUT_MS` | int 100–30000 | `5000` |
  | `SWAGGER_ENABLED` | `true`/`false` | `false` |
  | `LOG_LEVEL` | pino level | `info` |
  | `QR_SUCCESS_DELAY_SECONDS` | int 1–300 | `8` |
  | `QR_JOB_INTERVAL_SECONDS` | int ≥ 1 | `1` |
  | `QR_JOB_BATCH_SIZE` | int 1–1000 | `50` |
  | `QR_JOB_ENABLED` | `true`/`false` | `true` |
  | `OUTBOX_INTERVAL_SECONDS` | int ≥ 1 | `2` |
  | `OUTBOX_BATCH_SIZE` | int 1–1000 | `10` |
  | `OUTBOX_MAX_ATTEMPTS` | int 1–100 | `10` |
  | `OUTBOX_ENABLED` | `true`/`false` | `true` |

  The `*_ENABLED` flags are wiring only (interval registration in `onModuleInit`). Jobs never read them at call time.
- **Lock discipline (payments):**
  - Every job claims rows with `FOR UPDATE SKIP LOCKED LIMIT 1`, one DB transaction per row.
  - Every state change is a conditional `UPDATE … WHERE status = 'PENDING'`.
  - Every raw SQL statement is a parameterized `$queryRaw` tagged template with schema-qualified tables (`payments.*`).
- **Test file patterns:** unit tests are `src/**/*.spec.ts` (`pnpm test`); integration tests are `test/**/*.int-spec.ts` (`pnpm test:int`, Docker). Payment contract specs live in `packages/contract-tests/src/payment-service/*.contract.ts`.
- **Commits:** one per task, conventional, with the message given in the task, ending with the `Co-Authored-By` line the executor is told to use.

## Review Focus

1. **Replaying a card payment after its order is confirmed.** Spec §4.2 reads the order *before* the key check. Once the outbox has confirmed the order, that order would answer `409 ORDER_NOT_PAYABLE` to a legitimate retry instead of the stored `201`. Task 5 checks the stored key first (see "Spec amendment" in Task 5). Test in Task 5.
2. **Two payments for one order with different keys, in parallel.** Exactly one `201`; the other gets `409 PAYMENT_IN_PROGRESS` (QR) or `409 ORDER_ALREADY_PAID` (card), never 500. The same key sent twice in parallel gives one payment, and both answers carry the same body. Tests in Task 5.
3. **QR flip racing cancel.** Exactly one wins: either `SUCCEEDED`, with one transaction and one outbox event, or `CANCELLED`, with none. Never both, never a transaction on a cancelled payment. Test in Task 6.
4. **Downstream down or slow.** The Ticket Service is unreachable during `POST /v1/payments` → `502 UPSTREAM_UNAVAILABLE`; it hangs past `DOWNSTREAM_TIMEOUT_MS` → `504 UPSTREAM_TIMEOUT`. Neither may bind the idempotency key. The outbox worker keeps `confirm_outcome` across a ledger failure and never asks the Ticket Service twice. Tests in Tasks 5 and 7.
5. **Card data leaking.** The full PAN must appear nowhere:
   - not in the `payments` row or the `idempotency_keys` row (including `response_body`);
   - not in the request hash input;
   - not in any captured log line, including the log line for a `422 INVALID_CARD`.

   Test in Task 5.

---

## File Structure

```text
packages/nest-common/                 NEW — shared NestJS plumbing, built to dist/ (CJS + .d.ts)
  package.json  tsconfig.json  tsconfig.build.json  jest.config.cjs
  src/index.ts                        public API (barrel)
  src/correlation-id.ts               correlationIdOf, correlationIdMiddleware, CORRELATION_HEADER
  src/domain-error.ts                 DomainError
  src/error-envelope.filter.ts        ErrorEnvelopeFilter
  src/validation.ts                   createValidationPipe
  src/api-key.guard.ts                ApiKeyGuard, API_KEYS token, ApiKeys, Public, Internal
  src/fallback.controller.ts          FallbackModule
  src/logging.ts                      pinoHttpOptions({ service, level, stream })
  src/docs.ts                         setupDocs(app, enabled, contractFile)
  src/configure-app.ts                configureApp(app, { swaggerEnabled, contractFile })
  src/db-errors.ts  src/money.ts  src/schema.ts   isUniqueViolation, toMinor, schemaOf(url, fallback)
  src/*.spec.ts                       moved unit tests
packages/testing/src/http-stub.ts     NEW — startHttpStub()
apps/ticket-service/                  switched to @eticket/nest-common (files deleted, imports changed)
apps/payment-service/
  package.json  tsconfig*.json  jest*.cjs  .env.example  prisma.config.ts  prisma/schema.prisma (models)
  src/main.ts  src/app.module.ts  src/config/env.ts  src/common/prisma.service.ts  src/common/clock.ts
  src/health/health.controller.ts
  src/payments/domain/{luhn.ts,card-expiry.ts,request-hash.ts,payment-reference.ts,backoff.ts,errors.ts,types.ts}
  src/payments/handlers/{payment-handler.ts,card.handler.ts,qr.handler.ts,handler-registry.ts}
  src/payments/{payments.controller.ts,payments.service.ts,payments.repository.ts,payment.view.ts}
  src/payments/dto/create-payment.dto.ts  src/payments/idempotency-key.pipe.ts
  src/payments/qr-success.job.ts
  src/outbox/{outbox.worker.ts,outbox.repository.ts}
  src/downstream/{ticket.client.ts,ledger.client.ts,upstream-errors.ts}
  src/transactions/{transactions.controller.ts,transactions.repository.ts}
  test/support/{app.ts,stubs.ts}  test/*.int-spec.ts
packages/contract-tests/src/payment-service/{suite.ts,target.ts,*.contract.ts}
packages/contract-tests/test/payment-service.contract-spec.ts
infra/docker/nest-service.Dockerfile  NEW — one Dockerfile for every Nest service (ARG SERVICE, ARG PORT)
infra/docker-compose.yml  infra/.env.example
docs/adr/0019-nestjs-axios-outbound-http.md  docs/adr/0020-shared-nest-common-package.md
```

Design notes (not up for change in this phase):

- **`@eticket/nest-common` is compiled** (`tsc` → `dist/`, CommonJS, declarations).
  - Its `package.json` points `main` and `types` at `dist/`, and lists `"files": ["dist"]`. Apps run `node dist/src/main.js`, which needs compiled JavaScript for the package.
  - Every `@nestjs/*`, `nestjs-pino`, `pino-http`, `class-validator`, `class-transformer` and `rxjs` dependency is a **peerDependency**, with the same pinned version also in `devDependencies`. Two copies of `@nestjs/core` break `Reflector` and DI.
- **No repository interfaces.** Same reasoning as Phase 2: one Prisma implementation, integration-tested.
- **Handlers are pure.** A handler validates and returns a `HandlerResult`. The service persists the result and runs the success bookkeeping. A handler never touches the DB or HTTP.
- **The outbox worker holds its DB transaction across the two HTTP calls.** ADR-0006 accepts this, and the 5 s timeout per call bounds it.

---

### Task 1: Extract `@eticket/nest-common` and switch the Ticket Service to it

**Files:**

- Create: `packages/nest-common/**` (see File Structure).
- Create: `docs/adr/0020-shared-nest-common-package.md`.
- Modify: `apps/ticket-service/src/{main.ts,app.module.ts,common/prisma.service.ts,health/health.controller.ts,orders/**,ticket-types/**}` (imports only).
- Delete from `apps/ticket-service/src/common/`: the files that moved, and their specs.
- Modify: `apps/ticket-service/package.json` (add the dependency `@eticket/nest-common: workspace:*`).
- Modify: `docs/spec.md` §13 (ADR-0020 row).

**Interfaces:**

- Produces (`@eticket/nest-common`):

  ```ts
  export const API_KEYS = Symbol('API_KEYS');
  export interface ApiKeys { publicKey: string; internalKey?: string }  // no internalKey → the service has no internal scope; every /v1/internal/* or @Internal() route is 403 for any key
  export class ApiKeyGuard implements CanActivate {}                    // injects Reflector + API_KEYS
  export const Public: () => CustomDecorator; export const Internal: () => CustomDecorator;
  export abstract class DomainError extends Error { abstract readonly code: string; abstract readonly httpStatus: number }
  export class ErrorEnvelopeFilter implements ExceptionFilter {}
  export function createValidationPipe(): ValidationPipe;
  export class FallbackModule {}
  export function correlationIdOf(req: CorrelatedRequest): string;
  export function correlationIdMiddleware(req, res, next): void;
  export const CORRELATION_HEADER = 'x-correlation-id';
  export function pinoHttpOptions(opts: { service: string; level: string; stream?: DestinationStream; extraRedact?: string[] }): Options;
  export function configureApp(app: INestApplication, opts: { swaggerEnabled: boolean; contractFile: string }): void;
    // case-sensitive routing (app setting + router flag), correlation middleware, pino logger, filter, pipe, docs
  export function isUniqueViolation(err: unknown, constraint: string): boolean;
  export function toMinor(value: bigint): number;
  export function schemaOf(databaseUrl: string, fallback: string): string;
  ```

  `contractFile` is an absolute path. Each app resolves it as `dist/openapi.json` when that file exists, otherwise `require.resolve('@eticket/contracts/openapi/<service>.json')`; that logic leaves `docs.ts` and moves into each app.

- Consumes: the current Ticket Service files listed in File Structure. Move them; do not rewrite them.

- [ ] **Step 1: Create the package skeleton.**
  - `package.json`:
    - name `@eticket/nest-common`, private, `main: dist/index.js`, `types: dist/index.d.ts`, `files: ["dist"]`;
    - peer + dev dependencies at the Ticket Service's pinned versions;
    - scripts `build: tsc -p tsconfig.build.json`, `lint`, `test` (jest over `src/**/*.spec.ts`).
  - `tsconfig.json`: extends `@eticket/config/tsconfig.node.json` with the same decorator settings as the Ticket Service (`experimentalDecorators`, `emitDecoratorMetadata`, `isolatedModules: false`) and the same ts-jest diagnostic setting.
  - `tsconfig.build.json`: `declaration: true`, `outDir: dist`, `rootDir: src`, excludes specs.

  Run: `pnpm install && pnpm --filter @eticket/nest-common build` → succeeds (an empty barrel is fine).

- [ ] **Step 2: Move the code and its unit specs.** Use `git mv` so history follows. Generalize three things:
  - **Keys.** `ApiKeyGuard` reads keys from the `API_KEYS` provider instead of `ConfigService<…TICKET>`. With no `internalKey`, any request to an internal route throws `ForbiddenException`.
  - **Logging.** `pinoHttpOptions` takes `service`, and it **also sets `base: { service }`** (Phase 2 deferred item: app logs written inside a request lost `service`). Redaction covers `req.headers["x-api-key"]`, `req.headers.authorization`, `req.body.card.number`, `req.body.card.cvc` and any `extraRedact` paths.
  - **Schema.** `schemaOf(url, fallback)` takes the fallback schema instead of hard-coding `'tickets'`.

  Add these unit specs:

  ```ts
  it('ApiKeyGuard without internalKey forbids an @Internal() route for the public key', …ForbiddenException);
  it('pinoHttpOptions sets base.service', () => expect(pinoHttpOptions({ service: 's', level: 'info' }).base).toEqual({ service: 's' }));
  it('pinoHttpOptions redacts card number and cvc', () => expect(opts.redact).toEqual(expect.arrayContaining(['req.body.card.number', 'req.body.card.cvc'])));
  it('schemaOf falls back', () => expect(schemaOf('postgresql://x/db', 'payments')).toBe('payments'));
  ```

  Run: `pnpm --filter @eticket/nest-common test` → PASS (the moved specs plus 4 new).

- [ ] **Step 3: Write the redaction test that exercises `redact` itself** (Phase 2 deferred item). Add it to `packages/nest-common/src/logging.spec.ts`:
  1. Create a pino logger from `pinoHttpOptions({ service: 'x', level: 'info', stream })` with a capturing stream.
  2. Log `{ req: { headers: { 'x-api-key': 'SECRET-KEY-123' }, body: { card: { number: '4242424242424242', cvc: '123' } } } }` through it.
  3. Assert that the captured text contains neither `SECRET-KEY-123`, `4242424242424242` nor `"cvc":"123"`, and that it contains `[Redacted]`.

  Run → PASS.

- [ ] **Step 4: Switch the Ticket Service.**
  - Replace the moved imports with `@eticket/nest-common`.
  - Provide `{ provide: API_KEYS, useFactory: (c) => ({ publicKey: c.get('PUBLIC_API_KEY_TICKET'), internalKey: c.get('INTERNAL_API_KEY_TICKET') }), inject: [ConfigService] }`.
  - `createApp` calls `configureApp`.
  - Pass `service: 'ticket-service'`.
  - Delete the now-unused local files.
  - The Ticket Service's `test/**` files must not change except for import paths.

  Run: `pnpm build && pnpm --filter @eticket/ticket-service test && pnpm --filter @eticket/ticket-service test:int` → PASS with the **same counts as before the move**: 69 unit tests minus the specs that moved to nest-common, and 70 integration tests. Record the before/after counts in the report.

- [ ] **Step 5: Write ADR-0020** (context, decision, alternatives, trade-off):
  - Shared Nest plumbing lives in one compiled package with peer dependencies, so security fixes such as the Phase 2 key-scope fix land once.
  - Rejected: copying the code per service (drift; four copies of security code).
  - Trade-off: the Ticket Service now depends on a workspace package, so the Docker build must include it (Task 9).

  Add the §13 row: `| [0020](./adr/0020-shared-nest-common-package.md) | Shared NestJS plumbing in @eticket/nest-common | Copy per service |`.

- [ ] **Step 6: Verify and commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check && pnpm --filter @eticket/ticket-service test:int` → pass.
  Also run `docker build -f apps/ticket-service/Dockerfile -t eticket/ticket-service:dev .` → succeeds. The Dockerfile's filtered install (`--filter @eticket/ticket-service...`) already includes workspace dependencies. Fix the Dockerfile only if the build fails; Task 9 replaces it anyway.

  ```bash
  git add packages/nest-common apps/ticket-service docs/adr/0020-shared-nest-common-package.md docs/spec.md pnpm-lock.yaml
  git commit -m "refactor: extract shared NestJS plumbing into @eticket/nest-common"
  ```

---

### Task 2: Payment Service skeleton and HTTP stub helper

**Files:**

- Modify: `apps/payment-service/{package.json,tsconfig.json,jest.config.cjs,prisma.config.ts,prisma/schema.prisma}`.
- Create: `apps/payment-service/{tsconfig.build.json,jest.int.config.cjs,.env.example}`.
- Create: `src/main.ts`, `src/app.module.ts`, `src/config/env.ts` + `env.spec.ts`, `src/common/prisma.service.ts`, `src/common/clock.ts`, `src/health/health.controller.ts`.
- Create: `test/support/app.ts`, `test/support/stubs.ts`, `test/prisma-drift.int-spec.ts`, `test/health.int-spec.ts`.
- Create: `packages/testing/src/http-stub.ts` + export it from `packages/testing/src/index.ts`; `packages/testing/test/http-stub.int-spec.ts`.

**Interfaces:**

- Consumes: everything in `@eticket/nest-common` (Task 1); `startTestDatabase`, `applyMigrations(db, 'payment-service')` and `TestDatabase` from `@eticket/testing`.
- Produces:

  ```ts
  // @eticket/testing
  export interface StubCall { method: string; path: string; headers: Record<string, string | string[] | undefined>; body: unknown }
  export type StubReply = { status: number; body?: unknown; delayMs?: number } | 'drop';   // 'drop' destroys the socket (connection error)
  export interface HttpStub {
    url: string;                                   // http://127.0.0.1:<port>
    calls: StubCall[];
    on(method: string, pathPattern: RegExp, reply: StubReply | ((call: StubCall) => StubReply)): void;  // last registration wins
    reset(): void;                                 // clears calls and handlers
    close(): Promise<void>;
  }
  export function startHttpStub(): Promise<HttpStub>;   // unmatched request → 599 { error: 'no stub' }

  // apps/payment-service
  export const CLOCK = Symbol('CLOCK'); export interface Clock { now(): Date }   // SystemClock by default
  export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables;
  export async function createApp(env: Record<string, string | undefined>, options?: { logStream?: DestinationStream; clock?: Clock }): Promise<INestApplication>;
  // test/support/app.ts
  export interface RunningPaymentService { baseUrl: string; app: INestApplication; publicKey: string; close(): Promise<void> }
  export async function startPaymentService(db: TestDatabase, stubs: { ticket: HttpStub; ledger: HttpStub }, overrides?: Record<string, string>): Promise<RunningPaymentService>
    // DATABASE_URL = db.urlFor('payments_app'); fixed test keys; QR_JOB_ENABLED=false, OUTBOX_ENABLED=false; LOG_LEVEL=silent
  // test/support/stubs.ts
  export function stubPayableOrder(ticket: HttpStub, order?: Partial<{ id: string; totalMinor: number; currency: string; status: string; expiresAt: string }>): { id: string; totalMinor: number; currency: string };
    // registers GET /v1/orders/<id> → 200 with a contract-valid Order (default PENDING, 70000 AED, expires in 15 min)
  ```

- [ ] **Step 1: The stub helper, test first.** `packages/testing/test/http-stub.int-spec.ts` covers:
  - a JSON reply with its status;
  - a recorded call with headers and the parsed body;
  - `delayMs` holds the reply;
  - `'drop'` makes a fetch reject;
  - an unmatched request returns 599;
  - `reset()` clears calls and handlers.

  Implement it with `node:http` only (no new dependency). Run: `pnpm --filter @eticket/testing test:int` → PASS.

- [ ] **Step 2: Dependencies and config**, mirroring the Ticket Service.
  - Same Nest, Prisma and pino pins, plus `@eticket/nest-common: workspace:*`.
  - `tsconfig`, `tsconfig.build.json`, both jest configs, and the scripts `generate`, `build` (which copies `@eticket/contracts/openapi/payment-service.json` to `dist/openapi.json`), `lint`, `test`, `test:int`, `start`.
  - The same `prisma.config.ts` tolerance for a missing `MIGRATION_DATABASE_URL`.
  - The generator `prisma-client` with `output = "../src/generated/prisma"`, `moduleFormat = "cjs"`, `importFileExtension = ""`.
  - Add `"build": { "dependsOn": ["^build"] }`-style ordering only if Turbo does not already order nest-common first. It should, via `^build`.

- [ ] **Step 3: Prisma models plus the failing drift test.** Add models `Payment`, `Transaction`, `IdempotencyKey`, `OutboxEvent` that mirror `apps/payment-service/prisma/migrations/*/migration.sql` exactly:
  - snake_case `@map`; `@db.Uuid`, `@db.Char(3)`, `@db.Char(4)`, `@db.Char(64)`, `@db.Timestamptz(6)`, `BigInt`, `Json` for `jsonb`;
  - relations `Transaction → Payment` and `IdempotencyKey → Payment`;
  - the migration's index and constraint names via `map:`.

  The partial unique index `payments_one_live_per_order` cannot be expressed in Prisma. Leave it to the SQL. If `prisma migrate diff` reports it as drift, the drift test must pass `--exit-code` while tolerating only that index: assert the diff output mentions nothing but `payments_one_live_per_order`, and record this in the report.

  `test/prisma-drift.int-spec.ts` uses the same approach as the Ticket Service.
  Run: `pnpm --filter @eticket/payment-service test:int -- prisma-drift` → FAIL, then PASS.

- [ ] **Step 4: Env unit tests**, then `validateEnv` (table in Global Constraints):

  ```ts
  const ok = { DATABASE_URL: 'postgresql://x/db?schema=payments', PUBLIC_API_KEY_PAYMENT: 'p'.repeat(32), TICKET_SERVICE_URL: 'http://ticket:3001', LEDGER_SERVICE_URL: 'http://ledger:3003', INTERNAL_API_KEY_TICKET: 't'.repeat(32), INTERNAL_API_KEY_LEDGER: 'l'.repeat(32) };
  it('applies defaults', () => expect(validateEnv(ok)).toMatchObject({ PORT: 3002, DOWNSTREAM_TIMEOUT_MS: 5000, QR_SUCCESS_DELAY_SECONDS: 8, QR_JOB_INTERVAL_SECONDS: 1, QR_JOB_BATCH_SIZE: 50, QR_JOB_ENABLED: true, OUTBOX_INTERVAL_SECONDS: 2, OUTBOX_BATCH_SIZE: 10, OUTBOX_MAX_ATTEMPTS: 10, OUTBOX_ENABLED: true, SWAGGER_ENABLED: false }));
  it('rejects a non-URL TICKET_SERVICE_URL', …toThrow(/TICKET_SERVICE_URL/));
  it('rejects a short INTERNAL_API_KEY_LEDGER', …toThrow(/INTERNAL_API_KEY_LEDGER/));
  it('lists every invalid variable in one error', …toThrow(/DATABASE_URL[\s\S]*PUBLIC_API_KEY_PAYMENT/));
  ```

- [ ] **Step 5: `createApp`, the module, health and `.env.example`.**
  - `createApp` uses `configureApp` with `contractFile` from `dist/openapi.json` or the contracts package.
  - `API_KEYS` provider is `{ publicKey: PUBLIC_API_KEY_PAYMENT }`, with no internal key.
  - Logging uses `service: 'payment-service'`.
  - `PrismaService` uses `schemaOf(url, 'payments')`, `connectionTimeoutMillis: 5000`, and `$disconnect` in `onApplicationShutdown`.
  - The health controller matches the Ticket Service's: live has no DB, ready does `SELECT 1` with a 2 s timeout.
  - The `Clock` provider is `SystemClock` unless `options.clock` is given.
  - `FallbackModule` is the last import.

  `test/health.int-spec.ts`:
  - live is 200 with no key;
  - ready is 200;
  - ready is 503 within 3 s when the DB URL points at `127.0.0.1:1`;
  - `GET /v1/transactions` with no key is 401 (the fallback route plus the guard).

  Run: `pnpm --filter @eticket/payment-service test && pnpm --filter @eticket/payment-service test:int` → PASS.

- [ ] **Step 6: Commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check` → pass.

  ```bash
  git add apps/payment-service packages/testing .gitignore pnpm-lock.yaml
  git commit -m "feat(payment-service): add NestJS skeleton on nest-common and an HTTP stub helper"
  ```

---

### Task 3: Payment domain — card checks, request hash, payment reference, handlers, backoff

**Files:**

- Create: `apps/payment-service/src/payments/domain/{types.ts,errors.ts,luhn.ts,card-expiry.ts,request-hash.ts,payment-reference.ts,backoff.ts}` + a `*.spec.ts` for each logic file.
- Create: `src/payments/handlers/{payment-handler.ts,card.handler.ts,qr.handler.ts,handler-registry.ts}` + specs.
- Create: `src/payments/dto/create-payment.dto.ts`.

**Interfaces:**

- Produces:

  ```ts
  export type PaymentMethod = 'CARD' | 'QR'; export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'CANCELLED';
  export interface CardInput { number: string; expMonth: number; expYear: number; cvc: string; holder: string }
  export interface CreatePaymentInput { orderId: string; method: PaymentMethod; card?: CardInput }
  // errors (DomainError subclasses): InvalidCardError 422 INVALID_CARD (message never contains the PAN),
  // OrderNotFoundError 404 ORDER_NOT_FOUND, OrderNotPayableError 409 ORDER_NOT_PAYABLE,
  // PaymentInProgressError 409 PAYMENT_IN_PROGRESS, OrderAlreadyPaidError 409 ORDER_ALREADY_PAID,
  // PaymentNotFoundError 404 NOT_FOUND, PaymentNotCancellableError 409 PAYMENT_NOT_CANCELLABLE,
  // IdempotencyKeyReuseError 422 IDEMPOTENCY_KEY_REUSE, UpstreamUnavailableError 502 UPSTREAM_UNAVAILABLE,
  // UpstreamTimeoutError 504 UPSTREAM_TIMEOUT
  export function isLuhnValid(digits: string): boolean;
  export function isCardExpired(expMonth: number, expYear: number, now: Date): boolean;  // expired = before the current UTC month
  export function hashInput(input: CreatePaymentInput): object;      // { orderId, method, card?: { last4, expMonth, expYear, holder } } — PAN and CVC dropped
  export function requestHash(input: CreatePaymentInput): string;   // sha256 hex of canonicalJson(hashInput(input)) (spec §4.2)
  export function canonicalJson(value: unknown): string;            // sorted keys at every depth, no whitespace
  export function newPaymentReference(now: Date, random?: (bytes: number) => Buffer): string;  // PAY-<UTC yyyymmdd>-<6 Crockford base32>
  export function nextAttemptDelaySeconds(attempts: number): number; // min(2^attempts, 300); attempts = value AFTER increment
  // handlers (ADR-0008)
  export interface PaymentContext { paymentId: string; orderId: string; amountMinor: number; currency: string; input: CreatePaymentInput; now: Date }
  export type HandlerResult =
    | { kind: 'SUCCEEDED'; details: { cardLast4: string } }
    | { kind: 'PENDING'; details: { qrPayload: string }; succeedAfterSeconds: number };
  export interface PaymentHandler { readonly method: PaymentMethod; validate(input: CreatePaymentInput, now: Date): void; initiate(ctx: PaymentContext): HandlerResult }
  export const PAYMENT_HANDLERS = Symbol('PAYMENT_HANDLERS');
  export class HandlerRegistry { constructor(handlers: PaymentHandler[]); get(method: PaymentMethod): PaymentHandler }  // throws on a duplicate or missing method
  ```

  `QrHandler` takes `QR_SUCCESS_DELAY_SECONDS` through its constructor and returns `succeedAfterSeconds`. The repository computes `succeed_after = now() + make_interval(secs => …)` in SQL, so the time comes from the DB clock (Global Constraints).

- [ ] **Step 1: Write the failing unit tests:**

  ```ts
  // luhn
  it.each(['4242424242424242', '5555555555554444', '378282246310005'])('accepts %s', n => expect(isLuhnValid(n)).toBe(true));
  it.each(['4242424242424241', '1234567812345678', ''])('rejects %s', n => expect(isLuhnValid(n)).toBe(false));
  // expiry (now = 2026-11-14T10:00:00Z)
  it('current month is not expired', () => expect(isCardExpired(11, 2026, now)).toBe(false));
  it('previous month is expired', () => expect(isCardExpired(10, 2026, now)).toBe(true));
  it('previous year is expired', () => expect(isCardExpired(12, 2025, now)).toBe(true));
  // hash
  it('uses last4, never the PAN or CVC', () =>
    expect(canonicalJson(hashInput(cardInput))).toBe(`{"card":{"expMonth":12,"expYear":2030,"holder":"Jane Doe","last4":"4242"},"method":"CARD","orderId":"${ORDER_ID}"}`));
  it('same body → same hash regardless of key order', …);
  it('different card last4 → different hash', …);
  it('QR without card hashes without a card key', …);
  // reference
  it('formats PAY-yyyymmdd-6 chars from the Crockford alphabet', () => expect(newPaymentReference(new Date('2026-11-13T23:59:59Z'))).toMatch(/^PAY-20261113-[0-9A-HJKMNP-TV-Z]{6}$/));
  it('uses the UTC date', () => expect(newPaymentReference(new Date('2026-11-13T22:30:00-05:00'))).toMatch(/^PAY-20261114-/));
  it('is deterministic for given random bytes', () => expect(newPaymentReference(d, () => Buffer.alloc(6, 0))).toBe('PAY-20261113-000000'));
  // backoff
  it.each([[1, 2], [2, 4], [8, 256], [9, 300], [10, 300]])('attempts %i → %i s', (a, s) => expect(nextAttemptDelaySeconds(a)).toBe(s));
  // handlers
  it('CardHandler: Luhn-invalid → InvalidCardError whose message has no PAN', …);
  it('CardHandler: expired → InvalidCardError', …);
  it('CardHandler: missing card → InvalidCardError', …);
  it('CardHandler.initiate → SUCCEEDED with last4', …);
  it('QrHandler.validate rejects a card (400-equivalent handled by DTO; handler throws if card present)', …);
  it('QrHandler.initiate → PENDING, qrPayload eticket:pay:<paymentId>, succeedAfterSeconds = delay', …);
  it('HandlerRegistry throws on an unknown method and on duplicates', …);
  ```

  Run: `pnpm --filter @eticket/payment-service test` → FAIL.

- [ ] **Step 2: Write the DTO.**
  - `orderId` is `@IsUUID()`.
  - `method` is `@IsIn(['CARD','QR'])`.
  - `card` is `@ValidateIf(o => o.card !== undefined) @ValidateNested() @Type(() => CardDto)`.
  - `CardDto` follows the contract `CardDetails`:
    - `number` matches `^[0-9]{12,19}$`;
    - `expMonth` is an int 1–12;
    - `expYear` is an int 2000–2099;
    - `cvc` matches `^[0-9]{3,4}$`;
    - `holder` is 1–100 chars.
  - A class-level custom validator enforces that `card` is required for `CARD` and must be absent for `QR`, both as 400 `VALIDATION_ERROR`.
  - Luhn and expiry are **not** in the DTO: they are 422 from the handler.
  - Validation messages must not echo the value. Set `validationError: { target: false, value: false }` on this DTO's pipe usage if the shared pipe does not already.

- [ ] **Step 3: Implement the code to make the tests pass.**
  - Payment reference: Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Map each of 6 random bytes with `byte % 32`. The bias is acceptable for a simulation reference; note it in a comment.
  - The CSPRNG is `crypto.randomBytes`.

  Run → PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/payment-service
  git commit -m "feat(payment-service): add card checks, request hash, payment reference and method handlers"
  ```

---

### Task 4: Downstream clients over `@nestjs/axios`, ADR-0019

**Files:**

- Create: `src/downstream/{ticket.client.ts,ledger.client.ts,upstream-errors.ts}`, `test/downstream.int-spec.ts`.
- Create: `docs/adr/0019-nestjs-axios-outbound-http.md`.
- Modify: `docs/spec.md` §13.
- Modify: `apps/payment-service/package.json` (`@nestjs/axios@4`, the `axios` version it requires, both pinned exactly).

**Interfaces:**

- Produces:

  ```ts
  export interface TicketOrder { id: string; status: 'PENDING' | 'CONFIRMED' | 'EXPIRED'; totalMinor: number; currency: string; expiresAt: string }
  export type ConfirmOutcome = 'CONFIRMED' | 'NOT_CONFIRMABLE';
  export class TicketClient {
    getOrder(orderId: string, correlationId: string): Promise<TicketOrder | null>;          // 404 → null
    confirmOrder(orderId: string, transactionId: string, correlationId: string): Promise<ConfirmOutcome>; // 200 → CONFIRMED; 409 with code ORDER_NOT_CONFIRMABLE → NOT_CONFIRMABLE
  }
  export type PostingType = 'TICKET_SALE' | 'UNFULFILLED_PAYMENT';
  export interface PostingRequest { transactionId: string; postingType: PostingType; orderId: string; paymentReference: string; amountMinor: number; currency: string }
  export class LedgerClient { post(req: PostingRequest, correlationId: string): Promise<void> }   // 200 or 201 → resolve
  // Every other outcome throws:
  export class UpstreamTimeoutError extends DomainError {}      // 504 UPSTREAM_TIMEOUT (axios ECONNABORTED / ETIMEDOUT / AbortSignal timeout)
  export class UpstreamUnavailableError extends DomainError {}  // 502 UPSTREAM_UNAVAILABLE (connection refused/reset, DNS, any unexpected status)
  ```

  Both errors are defined once, in Task 3's `src/payments/domain/errors.ts`. `upstream-errors.ts` only re-exports them, and the clients import them from there.

  - `HttpModule.registerAsync` sets `timeout: DOWNSTREAM_TIMEOUT_MS`, `validateStatus: () => true` (the clients map statuses themselves) and `maxRedirects: 0`.
  - Headers: `X-Api-Key` (the Ticket internal key for `TicketClient`, the Ledger internal key for `LedgerClient`), `X-Correlation-Id`, `Content-Type: application/json`.
  - Base URLs come from `TICKET_SERVICE_URL` and `LEDGER_SERVICE_URL`.
  - The clients use `firstValueFrom`; there are no Observables in their public API.
  - Error messages carry the downstream name and the status, never a key or a body.

- [ ] **Step 1: Write the failing integration tests** `test/downstream.int-spec.ts`. They boot the app with `startPaymentService` and stubs, and use `app.get(TicketClient)` and `app.get(LedgerClient)`. They do not need the DB.
  - `getOrder`: 200 → typed order; 404 → null; 500 → `UpstreamUnavailableError`; stub `'drop'` → `UpstreamUnavailableError`; `delayMs` past a `DOWNSTREAM_TIMEOUT_MS: '300'` override → `UpstreamTimeoutError`.
  - Each response the tests use is checked with `ContractValidator.load('ticket-service').assertResponse('getOrder', …)` when the stub is registered, so stubs cannot drift from the contract.
  - Outbound headers: `calls[0].headers['x-api-key']` equals the Ticket internal key, and `x-correlation-id` equals the value passed in. The Ledger call carries the Ledger internal key.
  - `confirmOrder`: 200 → `'CONFIRMED'`; 409 `ORDER_NOT_CONFIRMABLE` → `'NOT_CONFIRMABLE'`; 409 with another code → `UpstreamUnavailableError`; 404 → `UpstreamUnavailableError`.
  - `LedgerClient.post`: 201 and 200 resolve; 409 `POSTING_CONFLICT` → `UpstreamUnavailableError` (spec §4.4: anything else is transient); timeout → `UpstreamTimeoutError`. The body sent equals the `PostingRequest` and is valid against the Ledger contract's `PostingRequest` schema. Check it with the Ajv validator by compiling `components.schemas.PostingRequest` from the bundled `ledger-service.json`, adding a `validateSchema(service, schemaName, value)` helper to `ContractValidator` if needed.

  Run → FAIL.

- [ ] **Step 2: Implement the clients and `HttpModule` wiring.** If you add `ContractValidator.validateSchema`, also add `'ledger-service'` and `'payment-service'` to `ServiceName`, and add `bundle` entries in `@eticket/contracts` for `payment-service.yaml` and `ledger-service.yaml`, the same way as `ticket-service`.
  Run → PASS.

- [ ] **Step 3: Write ADR-0019** (context, decision, alternatives, trade-off):
  - `@nestjs/axios` + `axios` for service-to-service HTTP, chosen by the user on 2026-11-14.
  - Rejected: Node's built-in `fetch` (no dependency, but hand-written timeout and status plumbing) and `openapi-fetch` (listed in AGENTS.md for the web app only).
  - Trade-off: two dependencies and RxJS at the call sites, kept out of the clients' public API with `firstValueFrom`.

  Add the §13 row.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/payment-service packages/contract-tests packages/contracts docs/adr/0019-nestjs-axios-outbound-http.md docs/spec.md pnpm-lock.yaml
  git commit -m "feat(payment-service): add Ticket and Ledger clients over @nestjs/axios (ADR-0019)"
  ```

---

### Task 5: Create and read payments — idempotency, one live payment, card success, QR pending

**Files:**

- Create:
  - `src/payments/{payments.controller.ts,payments.service.ts,payments.repository.ts,payment.view.ts,idempotency-key.pipe.ts}`
  - `test/payments.int-spec.ts`, `test/idempotency.int-spec.ts`, `test/card-data.int-spec.ts`
  - `packages/contract-tests/src/payment-service/{suite.ts,target.ts,payments.contract.ts,auth.contract.ts,health.contract.ts}`
  - `apps/payment-service/test/contract.int-spec.ts` (runner 1)
- Modify:
  - `packages/contracts/openapi/payment-service.yaml` (createPayment adds 502 and 504; additive, no version bump), plus regenerate the types;
  - `docs/spec.md` §4.2 (the spec amendment below);
  - `packages/contract-tests/src/index.ts`.

**Interfaces:**

- Consumes: Task 3 domain and handlers, Task 4 `TicketClient`, `isUniqueViolation` and `toMinor`.
- Produces:

  ```ts
  export interface PaymentView { id: string; orderId: string; method: PaymentMethod; status: PaymentStatus; amountMinor: number; currency: string; cardLast4: string | null; qrPayload: string | null; transaction?: { transactionId: string; paymentReference: string; createdAt: string }; createdAt: string; succeededAt: string | null; cancelledAt: string | null }
  export type CreateResult = { view: PaymentView; replayed: boolean };
  export class PaymentsService {
    create(input: CreatePaymentInput, idempotencyKey: string, correlationId: string): Promise<CreateResult>;
    get(paymentId: string): Promise<PaymentView>;                          // PaymentNotFoundError
  }
  export class PaymentsRepository {
    findKey(key: string): Promise<{ requestHash: string; responseStatus: number | null; responseBody: unknown } | null>;
    createWithKey(args: { key: string; requestHash: string; paymentId: string; order: TicketOrder; method: PaymentMethod; result: HandlerResult; correlationId: string; now: Date }): Promise<{ kind: 'CREATED'; view: PaymentView } | { kind: 'REPLAY'; body: unknown } | { kind: 'KEY_REUSE' }>;
    findView(paymentId: string): Promise<PaymentView | null>;
    liveStatusFor(orderId: string): Promise<'PENDING' | 'SUCCEEDED' | null>;
    // success bookkeeping, shared with the QR job (Task 6):
    recordSuccess(tx: Tx, paymentId: string, correlationId: string | null, now: Date): Promise<void>;
  }
  // packages/contract-tests
  export interface PaymentContractTarget {
    baseUrl: string; publicApiKey: string;
    qrDelaySeconds: number;                                   // the target's QR_SUCCESS_DELAY_SECONDS
    newPayableOrder(): Promise<{ id: string; totalMinor: number; currency: string }>;
  }
  export function paymentTargetFromEnv(): PaymentContractTarget;
    // CONTRACT_PAYMENT_BASE_URL, CONTRACT_PAYMENT_API_KEY, CONTRACT_QR_DELAY_SECONDS (default 8);
    // newPayableOrder → POST {CONTRACT_TICKET_BASE_URL}/v1/orders with CONTRACT_TICKET_API_KEY, body GOLD×1
  export function runPaymentServiceContract(getTarget: () => PaymentContractTarget): void;
  ```

**Spec amendment (record it in §4.2 in this task).** Replace steps 2–3 of §4.2 with this order:

1. **Validate** (400) and run the handler's `validate` (422 `INVALID_CARD`).
2. **Pre-read the key.** A completed key row with the same hash → **replay**. With a different hash → `422 IDEMPOTENCY_KEY_REUSE`.
3. **Read the order** from the Ticket Service: not found → 404 `ORDER_NOT_FOUND`; not payable → 409 `ORDER_NOT_PAYABLE`; unreachable → 502; timeout → 504.
4. **Open the DB transaction** and run `INSERT … ON CONFLICT (key) DO NOTHING`. This still blocks behind a concurrent holder of the same key. On a conflict, replay or return 422 as in step 2.
5. Continue with the spec's steps 4–6.

Reason: once the outbox confirms an order, reading it first would turn a legitimate replay into a 409, so the stored response must win. The pre-read is lock-free; the insert inside the transaction stays the arbiter for concurrent duplicates. Add one sentence to §4.2: "Upstream failures while reading the order return `502 UPSTREAM_UNAVAILABLE` / `504 UPSTREAM_TIMEOUT` and do not bind the key."

**Algorithm `PaymentsService.create`:**

1. `handler = registry.get(input.method)`, then `handler.validate(input, clock.now())`.
2. Compute `hash = requestHash(input)`. Call `findKey(key)`. A row with `responseStatus !== null` → same hash returns `{ view: responseBody, replayed: true }`; a different hash throws `IdempotencyKeyReuseError`.
3. `order = ticket.getOrder(input.orderId, correlationId)`. `null` → `OrderNotFoundError`. If `order.status !== 'PENDING'` or `Date.parse(order.expiresAt) <= clock.now()` → `OrderNotPayableError`.
4. `paymentId = randomUUID()`, then `result = handler.initiate({ paymentId, orderId, amountMinor: order.totalMinor, currency: order.currency, input, now })`.
5. `repo.createWithKey(…)`. Inside one interactive `$transaction` with `{ maxWait: 5000, timeout: 10000 }`:
   1. `INSERT INTO payments.idempotency_keys (key, request_hash) VALUES (…) ON CONFLICT (key) DO NOTHING RETURNING key`.
   2. Zero rows → read the row. Same hash → `REPLAY`; a different hash → `KEY_REUSE`. Commit nothing new.
   3. Insert the payment:
      - CARD: `status='SUCCEEDED'`, `succeeded_at=now()`, `card_last4`.
      - QR: `status='PENDING'`, `qr_payload`, `succeed_after = now() + make_interval(secs => ${result.succeedAfterSeconds})`.
   4. CARD only: `recordSuccess(tx, paymentId, correlationId)`.
   5. Build the view, then `UPDATE payments.idempotency_keys SET payment_id, response_status = 201, response_body = ${view}::jsonb WHERE key = …`.
6. A unique violation on `payments_one_live_per_order` aborts the transaction. Catch it outside the transaction, then call `liveStatusFor(orderId)`: `'PENDING'` → `PaymentInProgressError`, otherwise `OrderAlreadyPaidError`. The key stays unbound.

**`recordSuccess(tx, paymentId, correlationId)`** (spec §4.3). For the QR path (Task 6), the payment is first moved to `SUCCEEDED` by the caller's conditional UPDATE. Then:

1. Generate `paymentReference = newPaymentReference(clock.now())`.
2. `INSERT INTO payments.transactions (id, payment_id, payment_reference) VALUES (gen_random_uuid(), …) ON CONFLICT (payment_reference) DO NOTHING RETURNING id, created_at`. On zero rows, regenerate and retry; after 3 tries throw an `Error` (→ 500, the whole transaction rolls back).

   This replaces spec §4.3's savepoint with `ON CONFLICT DO NOTHING`. The effect is the same, and no aborted statement needs a savepoint. Note it in spec §4.3, one sentence.
3. `INSERT INTO payments.outbox_events (type, payload) VALUES ('payment.succeeded', ${payload}::jsonb)`. The payload must be valid against `payment-succeeded.schema.json`: `transactionId`, `paymentId`, `orderId`, `paymentReference`, `amountMinor`, `currency`, `occurredAt` (= the transaction's `created_at`, ISO), and `correlationId` when present.

**Controller:**

- `POST /v1/payments` (`@HttpCode(201)`):
  - `@Headers('idempotency-key')` goes through `IdempotencyKeyPipe`: it must be present and 8–128 chars, otherwise `BadRequestException` → 400 `VALIDATION_ERROR`.
  - The correlation ID comes from `correlationIdOf(req)`.
  - On replay, set the response header `Idempotent-Replayed: true`.
- `GET /v1/payments/:paymentId` uses `ParseUUIDPipe`.

**Steps:**

- [ ] **Step 0: Contract and spec edits.**
  - Add `'502': UpstreamUnavailable` and `'504': UpstreamTimeout` responses to `createPayment`, each pointing at `./common.yaml#/components/schemas/Error`, with descriptions naming the codes.
  - Run `pnpm --filter @eticket/contracts lint && pnpm --filter @eticket/contracts generate && pnpm --filter @eticket/contracts build`.
  - Apply the §4.2 and §4.3 amendments above.

- [ ] **Step 1: Write the failing integration tests.** Each `describe` gets a fresh DB, the app started with stubs, and `stubPayableOrder` for each order.
  - **`test/payments.int-spec.ts`**:
    - **Card success:** 201.
      - The body has `status SUCCEEDED`, `amountMinor` equal to the stubbed `totalMinor` (the client cannot influence it), `cardLast4` `'4242'` and `transaction.paymentReference` matching the pattern.
      - The DB has one `transactions` row and one PENDING `outbox_events` row, whose payload is valid against the event JSON Schema (compile it with Ajv in the test).
    - **QR:** 201 with `status PENDING`, `qrPayload` = `eticket:pay:<id>`, no `transaction`, and `succeed_after` about created_at + 8 s (assert 7–9 s from the DB).
    - **Order checks:**
      - unknown order (stub 404) → 404 `ORDER_NOT_FOUND`;
      - a CONFIRMED order → 409 `ORDER_NOT_PAYABLE`;
      - a PENDING order whose `expiresAt` is in the past → 409 `ORDER_NOT_PAYABLE`.
    - **Upstream failures:** a ticket stub `'drop'` → 502 `UPSTREAM_UNAVAILABLE`; a ticket stub delay with `DOWNSTREAM_TIMEOUT_MS: '300'` → 504 `UPSTREAM_TIMEOUT`. In both cases a retry with the same key after fixing the stub → 201 (the key was not bound).
    - **One live payment per order:**
      - QR then card on the same order with different keys → the second gets 409 `PAYMENT_IN_PROGRESS`;
      - card then QR → 409 `ORDER_ALREADY_PAID`;
      - **race:** 6 concurrent card requests with different keys on one order → exactly one 201, five 409 `ORDER_ALREADY_PAID`, no 500, and one payment row.
    - **Read:** `GET /v1/payments/{id}` → 200 with the same body as the create response; unknown → 404 `NOT_FOUND`; non-UUID → 400.
  - **`test/idempotency.int-spec.ts`**:
    - **Missing, short or long key:** missing → 400; 7 chars → 400; 129 chars → 400.
    - **Replay:** the same key and same body twice → both 201 with deep-equal bodies, the second has the header `idempotent-replayed: true`, and there is one payment row.
    - **Reuse:** the same key with a different body (another `holder`) → 422 `IDEMPOTENCY_KEY_REUSE`.
    - **Replay after the order is confirmed** (Review Focus 1):
      1. Create a card payment.
      2. Re-stub the order as `CONFIRMED`.
      3. Replay → 201 with the stored body and the replay header. It must not be 409.
    - **QR replay after success:** returns the original PENDING body (ADR-0005).
    - **A failure does not bind:**
      - a Luhn-invalid card → 422 `INVALID_CARD`, then the same key with a valid card → 201;
      - an unknown order → 404, then the same key with a payable order → 201.
    - **Parallel identical requests:** 5 at once with the same key and body → all 201 with deep-equal bodies, one payment row, and exactly 4 marked replayed.
  - **`test/card-data.int-spec.ts`** (Review Focus 5). Capture logs through the `logStream` option. Use the PAN `4242424242424242` and CVC `987`:
    1. Make one card payment, one replay, and one Luhn-invalid request using `4242424242424241`.
    2. Assert that neither PAN appears in:
       - `payments` rows (`SELECT row_to_json(p)::text`);
       - `idempotency_keys` rows, including `response_body`;
       - the `outbox_events` payload;
       - the captured log text;
       - any response body.
    3. Assert that the key `"cvc"` and the JSON fragment `"cvc":"987"` appear in neither the captured logs nor any DB row text. Do not search for the bare digits `987`: they can occur inside random UUIDs.

- [ ] **Step 2: Write the failing payment contract area.** Add `packages/contract-tests/src/payment-service/`:
  - `health.contract.ts`
  - `auth.contract.ts`: no key → 401; a wrong key → 401; an unknown route with the key → 404.
  - `payments.contract.ts`, validating every response with `ContractValidator.load('payment-service')`:
    - card 201 (`createPayment`) with the replay header absent;
    - the same key replayed → 201 with `Idempotent-Replayed: true` and a deep-equal body;
    - the same key with a different body → 422;
    - a missing key → 400;
    - a Luhn-invalid card → 422 `INVALID_CARD`;
    - an unknown order UUID → 404 `ORDER_NOT_FOUND`;
    - QR 201 PENDING, then **poll** `GET /v1/payments/{id}` every 500 ms up to `qrDelaySeconds + 5` s until `SUCCEEDED`, which has a `transaction`. Register this test now, but it only passes once Task 6 ships the QR job. Mark it with `it.skip` in this task with the comment `// enabled in Task 6`, and Task 6 removes the skip;
    - a second payment for a paid order → 409 `ORDER_ALREADY_PAID`.

  `suite.ts` `runPaymentServiceContract`. Runner 1 is `apps/payment-service/test/contract.int-spec.ts`:
  - it starts the DB, the stubs and the app with `QR_SUCCESS_DELAY_SECONDS: '1'` and `QR_JOB_INTERVAL_SECONDS: '1'`;
  - `newPayableOrder` = `stubPayableOrder(ticket)`.

  Runner 2 is `packages/contract-tests/test/payment-service.contract-spec.ts`.

  Run: `pnpm --filter @eticket/payment-service test:int` → FAIL.

- [ ] **Step 3: Implement** the repository, service, view, pipe and controller, plus the module wiring (`PAYMENT_HANDLERS` multi-provider → `HandlerRegistry`).
  Run: `pnpm --filter @eticket/payment-service test && pnpm --filter @eticket/payment-service test:int` → PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/payment-service packages/contract-tests packages/contracts docs/spec.md
  git commit -m "feat(payment-service): create card and QR payments idempotently with one live payment per order"
  ```

---

### Task 6: Cancel and the QR success job

**Files:**

- Create: `src/payments/qr-success.job.ts`, `test/qr-job.int-spec.ts`, `test/cancel.int-spec.ts`.
- Modify: `payments.repository.ts`, `payments.service.ts`, `payments.controller.ts`, the module; `packages/contract-tests/src/payment-service/payments.contract.ts` (remove the Task 5 skip, add cancel cases).

**Interfaces:**

- Consumes: `recordSuccess` (Task 5).
- Produces:

  ```ts
  // PaymentsRepository
  cancel(paymentId: string): Promise<PaymentView | 'NOT_FOUND' | 'NOT_CANCELLABLE'>;
  succeedOneDueQr(now: Date): Promise<string | null>;   // one $transaction; returns the payment id or null
  // PaymentsService
  cancel(paymentId: string): Promise<PaymentView>;      // PaymentNotFoundError | PaymentNotCancellableError
  // QrSuccessJob
  runOnce(): Promise<number>;                           // loops succeedOneDueQr up to QR_JOB_BATCH_SIZE
  ```

**`cancel`:** `UPDATE payments.payments SET status='CANCELLED', cancelled_at=now() WHERE id=${id} AND status='PENDING' RETURNING id`. One row → return the view. Zero rows → if the payment exists, `NOT_CANCELLABLE`, else `NOT_FOUND`.

**`succeedOneDueQr`**, in one `$transaction`:

1. Claim:

   ```sql
   SELECT id FROM payments.payments
    WHERE status = 'PENDING' AND method = 'QR' AND succeed_after <= now()
    ORDER BY succeed_after
    FOR UPDATE SKIP LOCKED LIMIT 1
   ```

2. `UPDATE payments.payments SET status='SUCCEEDED', succeeded_at=now() WHERE id=${id} AND status='PENDING'`. Zero rows → null.
3. `recordSuccess(tx, id, <the correlationId the payment was created with>)`.

   The QR job has no request. To forward the original ID, read it from the idempotency key row's stored response. Simpler: store nothing new, and let `recordSuccess` take `correlationId: null` for the QR job, so the payload omits `correlationId` (it is optional in the event schema). Use `null`, and log the job's own `correlationId: 'job:qr-success'`.

**Job wiring:**

- When `QR_JOB_ENABLED`, register the interval `'qr-success'` with `QR_JOB_INTERVAL_SECONDS` in `onModuleInit`.
- A run is skipped while the previous one is still running.
- `onModuleDestroy` deletes the interval; `beforeApplicationShutdown` awaits the in-flight run.
- Errors are logged with the Error object and correlation ID `job:qr-success`.

This mirrors the Ticket Service's `OrderExpiryJob`. Read it and follow the same structure.

- [ ] **Step 1: Write the failing integration tests.**
  - **`cancel.int-spec.ts`**:
    - cancel a PENDING QR → 200 `CANCELLED` with `cancelledAt`;
    - cancelling it again → 409 `PAYMENT_NOT_CANCELLABLE`;
    - cancel a SUCCEEDED card payment → 409;
    - an unknown payment → 404;
    - after a cancel, a new card payment for the same order with a new key → 201 (the order is freed).
  - **`qr-job.int-spec.ts`** (`QR_JOB_ENABLED=false`; the job comes from `app.get`):
    - **Due payment:** a QR whose `succeed_after` is moved into the past by SQL → `runOnce()` → 1. The payment is `SUCCEEDED` with one transaction and one outbox event, and a second `runOnce()` → 0.
    - **Not yet due:** → 0.
    - **Cancelled:** → untouched.
    - **Batch size 2** with 3 due → 2, then 1.
    - **Flip racing cancel (Review Focus 3),** 30 iterations:
      1. Create a QR payment and make it due.
      2. Run `Promise.allSettled([job.runOnce(), service.cancel(id)])`.
      3. Assert exactly one of: the payment is `SUCCEEDED` with exactly 1 transaction and 1 outbox event, and the cancel rejected with `PaymentNotCancellableError`; or the payment is `CANCELLED` with 0 transactions and 0 events, and `runOnce` returned 0.
      4. Assert no other rejection type.
    - **Registration:** with `QR_JOB_ENABLED=true` and `QR_JOB_INTERVAL_SECONDS=1`, `SchedulerRegistry.getInterval('qr-success')` exists, and is gone after `close()`.
  - **Contract:** remove the Task 5 `it.skip` on the QR polling test. Add:
    - cancel of a PENDING QR → 200, validated with `cancelPayment`;
    - cancel again → 409 `PAYMENT_NOT_CANCELLABLE`.

  Run → FAIL.

- [ ] **Step 2: Implement** the repository methods, the service, `POST /v1/payments/:paymentId/cancel` (`ParseUUIDPipe`, `@HttpCode(200)`) and the job.
  Run: `pnpm --filter @eticket/payment-service test:int` → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/payment-service packages/contract-tests
  git commit -m "feat(payment-service): cancel pending payments and succeed due QR payments with SKIP LOCKED"
  ```

---

### Task 7: Outbox worker — confirm first, then post, with backoff

**Files:**

- Create: `src/outbox/{outbox.repository.ts,outbox.worker.ts}`, `test/outbox.int-spec.ts`.
- Modify: the module wiring.

**Interfaces:**

- Consumes: `TicketClient.confirmOrder`, `LedgerClient.post` (Task 4); `nextAttemptDelaySeconds` (Task 3).
- Produces:

  ```ts
  export class OutboxWorker {
    runOnce(): Promise<number>;            // processes up to OUTBOX_BATCH_SIZE events, one DB transaction each; returns how many were claimed
  }
  // OutboxRepository
  processOne(handler: (event: ClaimedEvent) => Promise<EventUpdate>): Promise<boolean>;  // claims one in a $transaction, runs the handler INSIDE it, applies the update; false if none due
  export interface ClaimedEvent { id: string; payload: PaymentSucceededPayload; confirmOutcome: ConfirmOutcome | null; attempts: number }
  export type EventUpdate =
    | { kind: 'DONE'; confirmOutcome: ConfirmOutcome }
    | { kind: 'RETRY'; confirmOutcome: ConfirmOutcome | null; error: string }      // attempts+1, next_attempt_at = now() + backoff, or FAILED when attempts+1 >= OUTBOX_MAX_ATTEMPTS
  ```

**Per event** (spec §4.4):

1. Claim:

   ```sql
   SELECT … FROM payments.outbox_events
    WHERE status = 'PENDING' AND next_attempt_at <= now()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED LIMIT 1
   ```

2. If `confirm_outcome` is null, call `ticket.confirmOrder(orderId, transactionId, cid)`. Hold the outcome in memory.
3. `postingType = outcome === 'CONFIRMED' ? 'TICKET_SALE' : 'UNFULFILLED_PAYMENT'`, then `ledger.post({ transactionId, postingType, orderId, paymentReference, amountMinor, currency }, cid)`.
4. **Success:** `UPDATE … SET status='DONE', confirm_outcome=${outcome}, processed_at=now()`.
5. **Any thrown error from step 2 or 3:**

   ```sql
   UPDATE … SET attempts = attempts + 1,
                confirm_outcome = ${outcome or existing},
                last_error = ${message, ≤ 500 chars},
                next_attempt_at = now() + make_interval(secs => ${nextAttemptDelaySeconds(attempts + 1)})
   ```

   If `attempts + 1 >= OUTBOX_MAX_ATTEMPTS`, also set `status='FAILED', processed_at=now()`, and log at error level with the event ID.
6. The correlation ID for the outbound calls is the payload's `correlationId` if present, else `outbox:<eventId>`.

Wiring is like the QR job: the interval is `'outbox'` with `OUTBOX_INTERVAL_SECONDS`; it is gated by `OUTBOX_ENABLED` at wiring time; the in-flight run is awaited on shutdown.

- [ ] **Step 1: Write the failing integration tests** `test/outbox.int-spec.ts`. Use `OUTBOX_ENABLED=false` and the worker from `app.get`. Seed events with real card payments, so the payloads are real.
  - **Happy path:** confirm stub 200, ledger stub 201 → `runOnce()` → 1.
    - The event is `DONE` with `confirm_outcome 'CONFIRMED'`.
    - The ledger call body has `postingType 'TICKET_SALE'`, the amount and the reference.
    - The confirm call path is `/v1/internal/orders/<orderId>/confirm` with body `{ transactionId }`.
    - Both calls carry the payment request's correlation ID.
  - **Not confirmable:** confirm stub 409 `ORDER_NOT_CONFIRMABLE` → posting type `UNFULFILLED_PAYMENT`, and the event is `DONE` with `NOT_CONFIRMABLE`.
  - **Confirm outcome survives a ledger failure** (Review Focus 4):
    1. Confirm 200, ledger 500 → the event stays `PENDING` with `attempts 1`, `confirm_outcome 'CONFIRMED'`, `last_error` set and `next_attempt_at` about now + 2 s.
    2. Set `next_attempt_at = now()` by SQL. Ledger 201 → `DONE`.
    3. **The confirm stub saw exactly 1 call.**
  - **Backoff and FAILED:**
    1. Run with `OUTBOX_MAX_ATTEMPTS: '3'` and the ledger stub always 500, setting `next_attempt_at = now()` by SQL between runs.
    2. Check `attempts` reaches 1 then 2, then becomes `FAILED` with `processed_at` at the third.
    3. A further `runOnce()` → 0.
    4. Assert `next_attempt_at - now()` after attempt 2 is about 4 s.
  - **Confirm transport failure:** confirm stub `'drop'` → `RETRY` with `confirm_outcome` still null; the next run calls confirm again.
  - **Ordering and claim:** 3 events → one `runOnce()` with batch 10 → 3, processed in `created_at` order (check the order of the stub calls).
  - **Concurrency:** two `runOnce()` in parallel over 5 events → each event is processed exactly once. The ledger stub sees 5 distinct `transactionId`s, no duplicates.
  - **Registration:** `OUTBOX_ENABLED=true` registers the `'outbox'` interval, and it is removed on `close()`.

  Run → FAIL.

- [ ] **Step 2: Implement** the repository and the worker.
  Run: `pnpm --filter @eticket/payment-service test:int` → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/payment-service
  git commit -m "feat(payment-service): deliver payment.succeeded via the outbox, confirming before posting"
  ```

---

### Task 8: List transactions

**Files:**

- Create: `src/transactions/{transactions.controller.ts,transactions.repository.ts,list-transactions.query.ts}`, `test/transactions.int-spec.ts`, `packages/contract-tests/src/payment-service/transactions.contract.ts`.

**Interfaces:**

- Produces: `GET /v1/transactions?page=1&pageSize=20` → `{ data: Transaction[], page, pageSize, total }`, newest first.
  - Each item has `transactionId`, `paymentReference`, `createdAt`, `paymentId`, `orderId`, `amountMinor`, `currency` and `method`, joined from `payments`.
  - The query DTO: `page` int ≥ 1 (default 1), `pageSize` int 1–100 (default 20).
  - Query strings are strings. This DTO alone uses `@Type(() => Number)` explicitly; the global pipe stays without implicit conversion.
  - `page=0`, `pageSize=101` and `page=abc` → 400.
  - The sort is `ORDER BY t.created_at DESC, t.id DESC`, so pages are stable.

- [ ] **Step 1: Write the failing tests.**
  - **Integration:**
    1. Create 3 card payments.
    2. `pageSize=2&page=1` → 2 items, newest first, `total 3`.
    3. `page=2` → 1 item.
    4. The items' `amountMinor`, `method` and `paymentReference` match the payments.
    5. `pageSize=101` → 400; `page=0` → 400.
  - **Contract:** 200 validated with `listTransactions` after one card payment; `pageSize=101` → 400.

  Run → FAIL.

- [ ] **Step 2: Implement.**
  - Count with `SELECT count(*)`.
  - Read the page with one join query: parameterized `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`.
  - Convert minor units with `toMinor`.

  Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/payment-service packages/contract-tests
  git commit -m "feat(payment-service): list transactions newest first with pagination"
  ```

---

### Task 9: One Dockerfile for Nest services, compose service, standalone contract run, docs, phase gate

**Files:**

- Create: `infra/docker/nest-service.Dockerfile`.
- Delete: `apps/ticket-service/Dockerfile`, after compose points at the new file.
- Modify: `infra/docker-compose.yml`, `infra/.env.example`, `AGENTS.md` (Commands), `packages/contract-tests/README.md`, `docs/spec.md` §7.1.

- [ ] **Step 1: Generalize the Dockerfile.**
  - `ARG SERVICE` is the app folder (`ticket-service` | `payment-service`). `ARG PORT` is used in `EXPOSE` and `HEALTHCHECK`.
  - Same stages and pruning as `apps/ticket-service/Dockerfile`. `pnpm deploy` must bring `@eticket/nest-common`'s `dist/` (its `files: ["dist"]`).
  - Build both images:
    - `docker build -f infra/docker/nest-service.Dockerfile --build-arg SERVICE=ticket-service --build-arg PORT=3001 -t eticket/ticket-service:dev .`
    - the same with `SERVICE=payment-service --build-arg PORT=3002 -t eticket/payment-service:dev`

    Both must succeed. Then run `docker run --rm --entrypoint node eticket/payment-service:dev -e "require('@eticket/nest-common')"` → exit 0.

- [ ] **Step 2: Compose.**
  - Point `ticket-service` at the new Dockerfile with build args.
  - Add a `payment-service` service:
    - depends on `postgres` (healthy), `migrate-payments` (completed successfully) and `ticket-service` (healthy);
    - environment, using `${VAR:?…}` for every secret:
      - `PORT: 3002`
      - `DATABASE_URL: postgresql://payments_app:${PAYMENTS_APP_PASSWORD:?…}@postgres:5432/eticketing?schema=payments`
      - `PUBLIC_API_KEY_PAYMENT`
      - `TICKET_SERVICE_URL: http://ticket-service:3001`
      - `LEDGER_SERVICE_URL: http://ledger-service:3003`. It does not exist until Phase 4; outbox events back off and are retried, which is expected.
      - `INTERNAL_API_KEY_TICKET`, `INTERNAL_API_KEY_LEDGER`
      - `SWAGGER_ENABLED: 'true'`, `LOG_LEVEL: info`
    - `ports: ['127.0.0.1:3002:3002']`;
    - a healthcheck on `/health/ready`.
  - `infra/.env.example`: add `PUBLIC_API_KEY_PAYMENT` and `INTERNAL_API_KEY_LEDGER` with ≥ 32-char placeholders and the existing `openssl rand -hex 32` comment.
  - **Never read or print `infra/.env`.** If it lacks a new key, append a generated value without printing it:

    ```bash
    grep -q '^PUBLIC_API_KEY_PAYMENT=' infra/.env || printf 'PUBLIC_API_KEY_PAYMENT=%s\n' "$(openssl rand -hex 32)" >> infra/.env
    ```

    Do the same for `INTERNAL_API_KEY_LEDGER`. Report the names you appended, never the values.

- [ ] **Step 3: Standalone run against compose.**

  ```bash
  docker compose -f infra/docker-compose.yml up -d --build --wait payment-service
  set -a; . infra/.env; set +a
  CONTRACT_PAYMENT_BASE_URL=http://127.0.0.1:3002 CONTRACT_PAYMENT_API_KEY="$PUBLIC_API_KEY_PAYMENT" \
    CONTRACT_TICKET_BASE_URL=http://127.0.0.1:3001 CONTRACT_TICKET_API_KEY="$PUBLIC_API_KEY_TICKET" \
    CONTRACT_QR_DELAY_SECONDS=8 pnpm --filter @eticket/contract-tests test:contract -- payment-service
  docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d eticketing -tAc \
    "SELECT status, count(*) FROM payments.outbox_events GROUP BY status"
  docker compose -f infra/docker-compose.yml logs payment-service | grep -cF "$PUBLIC_API_KEY_PAYMENT"
  docker compose -f infra/docker-compose.yml down -v
  ```

  Expected:
  - the payment contract suite passes with the same count as runner 1;
  - the outbox rows exist as `PENDING` (the Ledger is not up yet, so they back off; confirm already reached the real Ticket Service, so `confirm_outcome` may be set);
  - the key-leak count is `0`.

  If `test:contract` cannot filter by path, add a `test:contract:payment` script that runs only `test/payment-service.contract-spec.ts`.

- [ ] **Step 4: Docs.**
  - **`packages/contract-tests/README.md`:** the payment area, its env vars (`CONTRACT_PAYMENT_BASE_URL`, `CONTRACT_PAYMENT_API_KEY`, `CONTRACT_TICKET_BASE_URL`, `CONTRACT_TICKET_API_KEY`, `CONTRACT_QR_DELAY_SECONDS`), and that it creates orders and payments on the target.
  - **`docs/spec.md` §7.1:**
    - add the rows `DOWNSTREAM_TIMEOUT_MS` (5000), `QR_JOB_*` and `OUTBOX_*` (defaults from Global Constraints) for payment;
    - add the payment contract env vars to the contract-tests row.
  - **AGENTS.md Commands:**
    - Payment Service: `pnpm --filter @eticket/payment-service test` (unit) and `pnpm --filter @eticket/payment-service test:int` (integration).
    - Payment contract suite against a running target: the command from Step 3.

- [ ] **Step 5: Phase gate**, from a clean state.

  ```bash
  docker compose -f infra/docker-compose.yml down -v
  pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check
  infra/scripts/verify-db.sh && docker compose -f infra/docker-compose.yml down -v
  ```

  Expected: every command passes. Report the per-suite counts. `verify-db.sh` prints `DB OK`.

- [ ] **Step 6: Commit.**

  ```bash
  git add infra apps/ticket-service AGENTS.md packages/contract-tests/README.md docs/spec.md
  git commit -m "feat(infra): one Nest Dockerfile, payment-service in compose, payment contract run"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-14-phase-3-payment-service.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task, and a reviewer checks it before the next one starts. The money-critical tasks (5, 6 and 7) get Opus reviewers. This costs Claude tokens per task and per review.

**B — OpenCode hand-off (saves Claude tokens).** You are already on `phase-3-payment-service`. From the repo root:

```bash
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-14-phase-3-payment-service.md. \
You are on branch phase-3-payment-service; do not switch or create branches. Execute the plan's \
tasks 1 to 9 in order. For each task follow every step exactly, write the failing test before the \
code, run every Run command and compare with Expected, and make the commit given in the task. \
Do not edit the SQL migrations. Edit packages/contracts/openapi only where Task 5 Step 0 says so, \
and docs/spec.md only where Tasks 1, 4, 5 and 9 say so. Never run 'prisma migrate dev'. Never read \
or print infra/.env; only append missing keys as Task 9 shows. Pin exact dependency versions. \
Never put a card number or CVC in a log, error message, DB row or test snapshot. Check current \
docs for @nestjs/axios and Prisma 7 before using them. If a verification still fails after two fix \
attempts, stop and report the task, the command and its full output; never skip or weaken a test. \
Finish by printing each task's commit hash and the full Task 9 phase-gate output."
```

To choose the OpenCode model, add `-m <provider/model>`.

**After either option**, back in Claude Code (Opus):

- a whole-branch review on Opus, then one fix wave;
- the EGM drift check against spec §4.2–§4.4, §6 and §7;
- the phase summary.
