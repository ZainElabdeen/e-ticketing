# Phase 6 — Gateway (BFF) and Backoffice Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A NestJS Gateway (`apps/gateway`, port 3000) that is the only public backend (ADR-0012). It:

- holds the public-scope API keys;
- proxies exactly the contract's routes 1:1 to the Ticket, Payment and Ledger services, passing statuses, bodies and key headers through;
- applies CORS, helmet, correlation IDs and per-IP rate limits;
- issues backoffice JWTs at login and checks them on `/v1/backoffice/*`;
- passes a black-box gateway contract suite;
- carries the end-to-end smoke test through the edge.

**Architecture:** Built on `@eticket/nest-common`: `configureApp`, the envelope, correlation ID, pino logging, validation and `FallbackModule`. The Gateway does **not** use `ApiKeyGuard`: it is the public edge, and inbound requests carry no key.

- **Routing.** One explicit controller method per contract route (user decision). Each calls a shared `DownstreamClient` over `@nestjs/axios`, the same pattern the Payment Service already uses.
  - The allow-list is the code itself. No catch-all proxy exists, so `/v1/internal/*` and the unscoped service lists can never be reached.
- **Auth.**
  - Login checks one admin from env (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH_B64`) with `bcryptjs`.
  - It signs HS256 JWTs with `@nestjs/jwt`.
  - A `JwtAuthGuard` protects the backoffice controller.
- **Rate limits.** `@nestjs/throttler`, in memory and per IP: 100/min by default, `POST /v1/orders` 5/min, login 10/min. A 429 gets the envelope with `RATE_LIMITED` and a `Retry-After` header.
- **No database, no business logic, no aggregation.**

**Tech Stack:** Node 26, NestJS 11.2.10 (CJS), `@nestjs/axios` 4.0.1 + `axios` 1.21.1 (already used by Payment), `@nestjs/throttler`, `helmet`, `@nestjs/jwt` (new), `bcryptjs` (new), `nestjs-pino`, `class-validator`, Jest 30 + Supertest, Ajv.

**Spec:** [docs/spec.md](../spec.md):

- §2.1 and §2.2: the trust model; the Gateway holds the public keys only and never the internal ones.
- §4.6: backoffice routes, admin login and the JWT claims.
- §5: the SPA's API calls and error codes.
- §6: gateway downstream-failure behaviour (5 s timeout, 502/504, pass-through, no retries).
- §7: rate limits, helmet, CORS and logging.
- §7.1: env vars.

Contract: [gateway.yaml](../../packages/contracts/openapi/gateway.yaml). ADRs: 0010, 0012, 0013, 0016, 0018, 0019, 0020.

**Branch:** `phase-6-gateway` (already created from `dev`). Do not switch branches.

**Decisions taken for this plan (2026-11-14, by the user):**

- Explicit route controllers instead of a generic proxy middleware.
- `@nestjs/jwt` + `bcryptjs` for auth. ADR-0022 is written in Task 1.
- The admin hash is stored base64-encoded as `ADMIN_PASSWORD_HASH_B64`. It contains no `$`, so compose, shells, `node --env-file` and K8s Secrets all read it intact.

**Carried from earlier phases** (project memory `carry-forward-phase4-phase6`):

- The Gateway must **never** proxy Payment `/v1/transactions` or Ledger `/v1/journal-entries` / `/v1/accounts` on a public route. They are reachable only as JWT-protected `/v1/backoffice/*`. A test must prove it.
- Never shell-source `infra/.env`.

## Global Constraints

- **Carried from Phases 1–5:**
  - Node 26; exact pins (no `^`/`~`); `@eticket/*` scope.
  - `@nestjs/*` core stays on `11.2.10`.
  - Never read or print `infra/.env`.
  - Raw secrets never appear in logs, error messages or test snapshots.
- **New dependencies:** `@nestjs/jwt` and `bcryptjs` only, each the latest stable major, pinned exactly. `@nestjs/throttler` and `helmet` are already listed in AGENTS.md, so pin their latest stable as well. Add no other dependency.
- **Public routes, exactly the contract's, nothing else:**
  - `POST /v1/auth/login`
  - `GET /v1/ticket-types`
  - `POST /v1/orders`
  - `GET /v1/orders/{orderId}`
  - `POST /v1/payments`
  - `GET /v1/payments/{paymentId}`
  - `POST /v1/payments/{paymentId}/cancel`
  - `GET /v1/backoffice/transactions` (JWT)
  - `GET /v1/backoffice/ledger-entries` (JWT)
  - `GET /v1/backoffice/accounts` (JWT)
  - `GET /v1/backoffice/ticket-availability` (JWT)
  - `GET /health/live` and `GET /health/ready`
  - `GET /docs`, only when `SWAGGER_ENABLED=true`

  Every other path → 404 `NOT_FOUND` through `FallbackModule`, with no key check. This includes `/v1/internal/*`, `/v1/transactions`, `/v1/journal-entries` and `/v1/accounts`.
- **Downstream mapping:**

  | Gateway route | Downstream request |
  | --- | --- |
  | `GET /v1/ticket-types` | Ticket `GET /v1/ticket-types` |
  | `POST /v1/orders` | Ticket `POST /v1/orders` |
  | `GET /v1/orders/{orderId}` | Ticket `GET /v1/orders/{orderId}` |
  | `POST /v1/payments` | Payment `POST /v1/payments` |
  | `GET /v1/payments/{paymentId}` | Payment `GET /v1/payments/{paymentId}` |
  | `POST /v1/payments/{paymentId}/cancel` | Payment `POST /v1/payments/{paymentId}/cancel` |
  | `GET /v1/backoffice/transactions` | Payment `GET /v1/transactions` |
  | `GET /v1/backoffice/ledger-entries` | Ledger `GET /v1/journal-entries` |
  | `GET /v1/backoffice/accounts` | Ledger `GET /v1/accounts` |
  | `GET /v1/backoffice/ticket-availability` | Ticket `GET /v1/ticket-types` |

  - **Keys:** each downstream call carries that service's public key (`PUBLIC_API_KEY_TICKET`, `_PAYMENT`, `_LEDGER`). The Gateway never holds an internal key.
  - **Path parameters** are forwarded URL-encoded with `encodeURIComponent`. The Gateway does not validate UUIDs; the downstream service answers 400 or 404.
  - **Query strings:** only `page` and `pageSize` are forwarded, on the two paginated backoffice routes. All other query parameters are dropped.
  - **Request bodies** are forwarded as parsed JSON. The Gateway does not re-validate shop bodies; the downstream validates. Body limit is 100 KB (nest-common default).
- **Headers:**
  - **Request, forwarded downstream:** `X-Correlation-Id` (the Gateway-resolved ID), `X-Api-Key` (injected), `Content-Type: application/json`, and `Idempotency-Key` (payments create only, forwarded verbatim when present).
  - **Never forwarded downstream:** client `Authorization`, `Cookie`, `X-Api-Key`, `Host`, `X-Forwarded-*`.
  - **Response, forwarded to the client:** the downstream status, the downstream JSON body verbatim, and `Idempotent-Replayed` when present.
  - **Response, set by the Gateway:** `X-Correlation-Id` is the Gateway's own ID. It is the same value it sent downstream, so it matches the body's `correlationId`. Helmet sets its headers.
- **Downstream failure behaviour (spec §6):**
  - Per-call timeout `DOWNSTREAM_TIMEOUT_MS` (5000). Pass both an axios `timeout` and `signal: AbortSignal.timeout(ms)`, as in Payment's `downstream-http.ts`.
  - Connection failure → 502 `UPSTREAM_UNAVAILABLE`. Timeout → 504 `UPSTREAM_TIMEOUT`.
  - A downstream 4xx or 5xx with a JSON body → the same status with that body verbatim.
  - A downstream non-JSON body or an unexpected 3xx → 502 `UPSTREAM_UNAVAILABLE`.
  - **No retries.**
- **Auth (spec §4.6, ADR-0010):**
  - The login body is `{ email, password }`. `email` must look like an email and `password` must be 8–128 chars; unknown fields → 400 `VALIDATION_ERROR`.
  - A valid login → 200 `{ accessToken, expiresIn: 3600 }`.
  - The token is HS256 with claims `sub` (the admin email), `iat`, `exp` (1 h) and `iss: "e-ticketing-gateway"`.
  - Wrong email **or** wrong password → 401 `INVALID_CREDENTIALS`, with the same message for both. Always run the bcrypt compare, against a fixed dummy hash when the email does not match, so response time does not reveal whether the email exists.
  - The email comparison is case-insensitive and trimmed.
  - Backoffice routes need `Authorization: Bearer <jwt>`, verified with algorithm `HS256` only, the issuer checked and expiry enforced. A missing, malformed, wrongly signed, expired, wrong-issuer or `alg: none` token → 401 `UNAUTHORIZED`.
- **Rate limits (spec §7)**, per client IP, fixed 60 s windows:

  | Scope | Default | Env override |
  | --- | --- | --- |
  | default | 100/min | `RATE_LIMIT_DEFAULT_PER_MIN` |
  | `POST /v1/orders` | 5/min | `RATE_LIMIT_ORDERS_PER_MIN` |
  | `POST /v1/auth/login` | 10/min | `RATE_LIMIT_LOGIN_PER_MIN` |

  - A 429 returns the envelope with code `RATE_LIMITED` and a `Retry-After` header in seconds.
  - Health routes are exempt.
  - The client IP comes from Express `trust proxy` set to `TRUST_PROXY` hops (an int, default 0). Compose uses 0. Phase 9 sets the right hop count for Traefik.
- **Edge headers (spec §7):**
  - `helmet()` with its defaults. Relax `contentSecurityPolicy` only for `/docs` if Swagger UI needs it.
  - CORS allows only `WEB_ORIGIN`, with credentials off and methods `GET`, `POST`, `OPTIONS`.
  - Allowed request headers: `Content-Type`, `Authorization`, `Idempotency-Key`, `X-Correlation-Id`.
  - Exposed response headers: `X-Correlation-Id`, `Idempotent-Replayed`, `Retry-After`.
- **Health:**
  - `/health/live` → 200, with no downstream calls.
  - `/health/ready` → each downstream `/health/live` is GET'd with a 2 s timeout, in parallel. All up → 200. Otherwise 503 `{"status":"error","details":{…per service…}}`.
- **Env vars**, validated at boot; the process exits non-zero listing every invalid var:

  | Variable | Rule | Default |
  | --- | --- | --- |
  | `PORT` | int | `3000` |
  | `TICKET_SERVICE_URL` | required URL | — |
  | `PAYMENT_SERVICE_URL` | required URL | — |
  | `LEDGER_SERVICE_URL` | required URL | — |
  | `PUBLIC_API_KEY_TICKET` | required, ≥ 32 chars | — |
  | `PUBLIC_API_KEY_PAYMENT` | required, ≥ 32 chars | — |
  | `PUBLIC_API_KEY_LEDGER` | required, ≥ 32 chars | — |
  | `JWT_SECRET` | required, ≥ 32 bytes | — |
  | `ADMIN_EMAIL` | required, email | — |
  | `ADMIN_PASSWORD_HASH_B64` | required; base64 that decodes to a bcrypt hash matching `^\$2[aby]\$(1[0-9]\|0[4-9])\$[./A-Za-z0-9]{53}$` with cost ≥ 12 | — |
  | `WEB_ORIGIN` | required URL | — |
  | `SWAGGER_ENABLED` | bool | `false` |
  | `LOG_LEVEL` | pino level | `info` |
  | `DOWNSTREAM_TIMEOUT_MS` | int 100–30000 | `5000` |
  | `TRUST_PROXY` | int 0–5 | `0` |
  | `RATE_LIMIT_DEFAULT_PER_MIN` | int ≥ 1 | `100` |
  | `RATE_LIMIT_ORDERS_PER_MIN` | int ≥ 1 | `5` |
  | `RATE_LIMIT_LOGIN_PER_MIN` | int ≥ 1 | `10` |

- **Logging:**
  - `service: 'gateway'`, with the spec §7 fields.
  - Redaction is extended to `req.body.password`. The nest-common card and key paths stay.
  - Request and response headers are never logged.
- **Test file patterns:** unit tests are `src/**/*.spec.ts`; integration tests are `test/**/*.int-spec.ts`, using HTTP stubs from `@eticket/testing`. Gateway contract specs live in `packages/contract-tests/src/gateway/*.contract.ts`.
- **Commits:** one per task, conventional, with the message given in the task.

## Review Focus

1. **Exposing an internal or unscoped route by accident.** Every one of these paths must answer 404, and the stubs must record **no** downstream call:
   - `GET /v1/transactions`
   - `GET /v1/journal-entries`
   - `GET /v1/accounts`
   - `POST /v1/internal/orders/x/confirm`
   - `POST /v1/internal/postings`
   - `/V1/BACKOFFICE/accounts` without a token

   Tests are in Tasks 2 and 3.
2. **Header leakage both ways.**
   - Client `Authorization` and `X-Api-Key` must never reach a service.
   - A downstream `X-Api-Key` or `Set-Cookie` must never reach the client.
   - The public key must never appear in a Gateway response or log line.

   Tests are in Tasks 2 and 5.
3. **JWT bypasses.** All of these must answer 401:
   - `alg: none`
   - an HS256 token signed with a different secret
   - an expired token
   - a wrong issuer
   - a token sent as `Bearer` with extra spaces or in lowercase `bearer`
   - a token in a query parameter

   Test is in Task 3.
4. **Downstream failure.**
   - Service down → 502; service slow → 504.
   - A downstream 409 or 422 envelope reaches the SPA byte-for-byte, so the SPA can switch on `code`.
   - A replayed payment keeps `Idempotent-Replayed: true`.

   Tests are in Task 2.
5. **Rate-limit identity.**
   - With `TRUST_PROXY=0`, a client-supplied `X-Forwarded-For` must not reset its own limit.
   - With `TRUST_PROXY=1`, the first proxy hop's IP is used.

   Test is in Task 4.

---

## File Structure

```text
apps/gateway/
  package.json  tsconfig*.json  jest*.cjs  .env.example
  src/main.ts  src/app.module.ts  src/config/env.ts (+spec)  src/config/admin-hash.ts (+spec)
  src/health/health.controller.ts
  src/downstream/{downstream.client.ts,downstream.client.spec.ts}   one client, three service bases
  src/shop/{ticket-types.controller.ts,orders.controller.ts,payments.controller.ts}
  src/auth/{auth.controller.ts,auth.service.ts,jwt-auth.guard.ts,login.dto.ts} (+specs)
  src/backoffice/backoffice.controller.ts
  src/throttling/{throttler.config.ts,throttler-envelope.filter.ts}
  test/support/{app.ts,stubs.ts}  test/*.int-spec.ts
packages/contract-tests/src/gateway/{suite.ts,target.ts,*.contract.ts}
packages/contract-tests/test/gateway.contract-spec.ts
infra/scripts/admin-hash.mjs           prompts for a password, prints ADMIN_PASSWORD_HASH_B64 (and can append to infra/.env)
infra/docker-compose.yml  infra/.env.example  infra/scripts/{contract.mjs,smoke.mjs}
docs/adr/0022-gateway-auth-libraries-and-admin-hash.md
```

Design notes (not up for change in this phase):

- **One `DownstreamClient`, three bases.** Its method is `send(service: 'ticket'|'payment'|'ledger', method, path, { body?, query?, idempotencyKey?, correlationId })`, returning `{ status, body, headers }`. It never throws for an HTTP status. It throws `UpstreamUnavailableError` or `UpstreamTimeoutError` only for transport failures and non-JSON or unexpected bodies.
- **Pass-through helper.** A small `relay(res, result)` helper sets the status, copies only the allow-listed response headers and sends the body. Controllers stay one-liners.
- **The Gateway's own errors** (400 login validation, 401, 404, 429, 502, 504) use the nest-common envelope with the Gateway's correlation ID.

---

### Task 1: Gateway skeleton, config (incl. base64 admin hash), health, edge headers, ADR-0022

**Files:**

- Create: `apps/gateway/**` (skeleton, config, health, `test/support`), `infra/scripts/admin-hash.mjs`, `docs/adr/0022-gateway-auth-libraries-and-admin-hash.md`.
- Modify:
  - `docs/spec.md`: §4.6 (`ADMIN_PASSWORD_HASH_B64`), §7.1 (gateway rows), §13 (ADR row);
  - `AGENTS.md`: the Packages line gains `@nestjs/jwt`, `bcryptjs`, `@nestjs/axios` + `axios` for the gateway.

**Interfaces:**

- Produces:

  ```ts
  export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables;
  export function decodeAdminHash(b64: string): string;     // throws Error('ADMIN_PASSWORD_HASH_B64 …') naming the problem, never echoing the value
  export async function createApp(env: Record<string, string | undefined>, options?: { logStream?: DestinationStream }): Promise<INestApplication>;
  // test/support/app.ts
  export interface RunningGateway { baseUrl: string; app: INestApplication; adminEmail: string; adminPassword: string; close(): Promise<void> }
  export async function startGateway(stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub }, overrides?: Record<string, string>, options?: { logStream?: DestinationStream }): Promise<RunningGateway>;
    // generates a bcrypt(cost 12) hash of a fixed test password once per test run (cache in a module variable), base64-encodes it;
    // JWT_SECRET 48 random bytes hex; WEB_ORIGIN http://localhost:5173; high rate limits (10000) unless overridden; LOG_LEVEL silent
  ```

- [ ] **Step 1: Package setup.**
  - Mirror `apps/payment-service`: the same Nest, pino and axios pins, `@eticket/nest-common: workspace:*`, the dev dependencies `@eticket/testing`, `@eticket/contracts` and `@eticket/contract-tests`, the same tsconfig and jest configs, and the scripts (`build` copies `@eticket/contracts/openapi/gateway.json` to `dist/openapi.json`).
  - Add a `bundle` entry for `gateway.yaml` in `@eticket/contracts` if it is missing.
  - The Gateway has no Prisma.
  - Pin `@nestjs/jwt`, `bcryptjs`, `@nestjs/throttler` and `helmet`.

- [ ] **Step 2: Env and admin-hash unit tests first.**
  - **Defaults:** every default from the table.
  - **Missing values:** each required var, when missing, is named in the error.
  - **Format checks:** `JWT_SECRET` shorter than 32 → error; `WEB_ORIGIN` not a URL → error.
  - **`decodeAdminHash`:**
    - valid base64 of a `$2b$12$…` hash → the hash;
    - not base64, or base64 of `hello` → error;
    - cost 10 → error (cost ≥ 12);
    - the error message never contains the input.
  - All invalid vars are listed in one error.

  Run → FAIL. Implement `validateEnv` and `decodeAdminHash`. Run → PASS.

- [ ] **Step 3: `createApp`, health and edge.**
  - `configureApp` from nest-common, **without** `ApiKeyGuard` / `API_KEYS`. `FallbackModule` is the last import, so unknown paths get 404 with no key check.
  - `helmet()`; CORS per Global Constraints; `app.set('trust proxy', TRUST_PROXY)`.
  - Logging uses `service: 'gateway'` and `extraRedact: ['req.body.password']`.
  - Health: live, plus ready probing the three downstream `/health/live` URLs with a 2 s timeout each, in parallel. Use the `@nestjs/axios` HttpService directly, with the public keys **not** sent, since health routes are public.
  - `test/health.int-spec.ts`:
    - live is 200;
    - ready is 200 with all three stubs answering 200;
    - one stub `'drop'` → 503 within 3 s, with `details` naming that service;
    - an unknown path `/v1/nope` → 404 `NOT_FOUND` envelope;
    - `GET /v1/ticket-types` with an `Origin: http://evil.example` header → no `Access-Control-Allow-Origin`;
    - with `Origin: http://localhost:5173` → that origin echoed;
    - helmet headers present (`x-content-type-options: nosniff`).

- [ ] **Step 4: `infra/scripts/admin-hash.mjs`.**
  - Node 26 only; it imports `bcryptjs` from the gateway's `node_modules` via `createRequire`.
  - Reads a password from stdin with echo off when run in a TTY, otherwise from piped stdin.
  - Rejects passwords shorter than 12 chars.
  - Prints `ADMIN_PASSWORD_HASH_B64=<value>`, using cost 12.
  - With `--append infra/.env` and `--email <addr>`, it appends `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH_B64` only if they are missing. It never prints the password.
  - A unit test (in the gateway jest suite, spawning the script with piped input) checks the printed value decodes to a valid bcrypt hash that `bcryptjs.compareSync` accepts.

- [ ] **Step 5: Docs.**
  - **ADR-0022** (context, decision, alternatives, trade-off):
    - `@nestjs/jwt` + `bcryptjs`, chosen by the user, with no native build so multi-arch images work;
    - the base64 admin hash, which avoids `$` interpolation in compose and shells;
    - one admin from env;
    - expiry as the only revocation (ADR-0010).

    Rejected: `jose`, native `bcrypt`, `$$` escaping, a secret file.
  - **Spec:**
    - §4.6 renames the var to `ADMIN_PASSWORD_HASH_B64` and points to `infra/scripts/admin-hash.mjs`;
    - §7.1 gains rows for `ADMIN_PASSWORD_HASH_B64`, `TRUST_PROXY`, the three `RATE_LIMIT_*` and `DOWNSTREAM_TIMEOUT_MS` (gateway);
    - §13 gets the ADR row.

- [ ] **Step 6: Commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check && pnpm --filter @eticket/gateway test:int` → pass.

  ```bash
  git add apps/gateway infra/scripts/admin-hash.mjs packages/contracts docs AGENTS.md pnpm-lock.yaml
  git commit -m "feat(gateway): add NestJS gateway skeleton with config, health, edge headers and admin-hash tooling (ADR-0022)"
  ```

---

### Task 2: Downstream client and the shop routes

**Files:**

- Create: `src/downstream/*`, `src/shop/*`, `test/shop.int-spec.ts`, `test/allow-list.int-spec.ts`.
- Modify: `app.module.ts`.

**Interfaces:**

- Produces:

  ```ts
  export type Service = 'ticket' | 'payment' | 'ledger';
  export interface DownstreamResult { status: number; body: unknown; headers: Record<string, string> }  // headers: only idempotent-replayed (lowercased) when present
  export class DownstreamClient {
    send(service: Service, method: 'GET' | 'POST', path: string, opts: { correlationId: string; body?: unknown; query?: Record<string, string>; idempotencyKey?: string }): Promise<DownstreamResult>;
  }
  export function relay(res: Response, result: DownstreamResult): void;
  ```

  - Axios settings: `validateStatus: () => true`, `maxRedirects: 0`, timeout plus an AbortSignal.
  - Status handling:
    - a 2xx/4xx/5xx with a JSON body is returned as is;
    - a non-JSON body, or a 3xx → `UpstreamUnavailableError`;
    - ECONNABORTED, ETIMEDOUT or ERR_CANCELED → `UpstreamTimeoutError`;
    - any other transport error → `UpstreamUnavailableError`.

    These two errors are nest-common `DomainError`s: 502 `UPSTREAM_UNAVAILABLE` and 504 `UPSTREAM_TIMEOUT`, with messages naming only the service.
  - Every call sends only `X-Api-Key`, `X-Correlation-Id`, `Content-Type` and `Idempotency-Key` (when given). No other client header is forwarded.

- [ ] **Step 1: Write the failing integration tests** (stubs for all three services).
  - **Ticket routes:**
    - `GET /v1/ticket-types` → the stubbed 200 body verbatim.
    - The ticket stub saw `x-api-key` = `PUBLIC_API_KEY_TICKET` and `x-correlation-id` = the Gateway response's `x-correlation-id`.
    - `POST /v1/orders` forwards the JSON body unchanged and returns 201. A stubbed 409 `{statusCode:409,code:'QUOTA_EXCEEDED',…}` → 409 with a **deep-equal** body.
    - `GET /v1/orders/abc%2F..%2Fx` reaches the stub as `/v1/orders/abc%2F..%2Fx`, encoded, never `/v1/x`.
  - **Payment routes:**
    - `POST /v1/payments` with `Idempotency-Key: k-123456789` → the payment stub saw that header.
    - A stub response with header `Idempotent-Replayed: true` → the client sees `idempotent-replayed: true`.
    - A stubbed 422 `IDEMPOTENCY_KEY_REUSE` → passed through.
    - `GET /v1/payments/{id}` and `POST /v1/payments/{id}/cancel` → passed through.
  - **Header hygiene (Review Focus 2):**
    - A client sends `Authorization: Bearer x`, `X-Api-Key: client-key` and `Cookie: a=b`. None of them reach the stub, and the stub's `x-api-key` is the Gateway's own key.
    - A stub reply carries `Set-Cookie` and `X-Api-Key`. Neither reaches the client.
  - **Failure (Review Focus 4):**
    - stub `'drop'` → 502 `UPSTREAM_UNAVAILABLE`;
    - stub delay with `DOWNSTREAM_TIMEOUT_MS: '300'` → 504 `UPSTREAM_TIMEOUT`;
    - a stub 200 with a `text/html` body → 502;
    - a stub 302 → 502;
    - in every case the envelope's `correlationId` equals the response header.
  - **Allow-list (Review Focus 1),** in `allow-list.int-spec.ts`:
    1. Call each of `GET /v1/transactions`, `GET /v1/journal-entries`, `GET /v1/accounts`, `POST /v1/internal/orders/<uuid>/confirm`, `POST /v1/internal/postings` and `GET /v1/internal/x`.
    2. Each → 404 `NOT_FOUND`.
    3. Afterwards, every stub's `calls` is still empty.
  - **Query hygiene:** `GET /v1/ticket-types?evil=1` → the stub saw no query string.

  Run → FAIL.

- [ ] **Step 2: Implement** `DownstreamClient`, `relay` and the three shop controllers. Routes use `@Param` strings. Each controller method is about three lines.
  Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/gateway
  git commit -m "feat(gateway): proxy the shop routes with key injection, header hygiene and 502/504 mapping"
  ```

---

### Task 3: Login, JWT guard and backoffice routes

**Files:**

- Create: `src/auth/*`, `src/backoffice/backoffice.controller.ts`, `test/auth.int-spec.ts`, `test/backoffice.int-spec.ts`.
- Modify: `packages/contracts/openapi/gateway.yaml`: add `'400': { $ref: '#/components/responses/Downstream' }` to `backofficeTransactions` and `backofficeLedgerEntries`. The services now return 400 for a bad `page`/`pageSize`. This is additive: bump `info.version` to `2.1.0`, then regenerate and rebuild the contracts.

**Interfaces:**

- Produces:

  ```ts
  export class AuthService {
    login(email: string, password: string): Promise<{ accessToken: string; expiresIn: number }>;   // InvalidCredentialsError (401 INVALID_CREDENTIALS)
  }
  export class JwtAuthGuard implements CanActivate {}   // 401 UNAUTHORIZED via UnauthorizedException
  ```

  - **`login`:**
    - Normalize the email: `trim().toLowerCase()` on both sides.
    - `const hash = emailMatches ? adminHash : DUMMY_HASH`, where `DUMMY_HASH` is a fixed cost-12 bcrypt hash computed once at startup from a random value.
    - `await bcrypt.compare(password, hash)`, then `ok = emailMatches && compareResult`.
    - Sign with `{ sub: adminEmail }`, `issuer: 'e-ticketing-gateway'`, `expiresIn: 3600`, `algorithm: 'HS256'`.
  - **Guard:**
    - Header must match `/^Bearer ([A-Za-z0-9._-]+)$/` exactly; it is case-sensitive.
    - `jwtService.verify(token, { algorithms: ['HS256'], issuer: 'e-ticketing-gateway' })`.
    - Any failure → `UnauthorizedException('Missing or invalid token')`.
  - **Backoffice controller** carries `@UseGuards(JwtAuthGuard)` and the four routes from the mapping table. Paginated routes forward only `page` and `pageSize`, as raw strings when present.

- [ ] **Step 1: Write the failing tests.**
  - **`auth.int-spec.ts`:**
    - **Valid login:** the right credentials → 200, and the `accessToken` decodes with `sub`, `iss: e-ticketing-gateway` and `exp − iat = 3600`. Login is also accepted with a differently cased email.
    - **Same error for both mistakes:** a wrong password and an unknown email → 401 `INVALID_CREDENTIALS`, with identical messages.
    - **Bad bodies:**
      - a missing field, a 7-char password, an extra field, a non-email → 400 `VALIDATION_ERROR`;
      - malformed JSON → 400 `Malformed JSON body`.
    - **No password leakage:** the password never appears in captured logs. Use the `logStream` option and a distinctive password.
  - **`backoffice.int-spec.ts`:**
    - **Mapping:** with a valid token, each of the four routes hits the right downstream path with the right service key. Transactions with `?page=2&pageSize=5&x=1` → the stub saw exactly `page=2&pageSize=5`.
    - **Pass-through:** a downstream 400 is passed through.
    - **401s (Review Focus 3)**, each → 401 `UNAUTHORIZED` with **no** downstream call:
      - no header;
      - `Bearer` with an empty token;
      - lowercase `bearer <valid>`;
      - `Bearer  <valid>` (two spaces);
      - a token signed with another secret;
      - an expired token (sign one with `expiresIn: -10`);
      - a wrong issuer;
      - an `alg: none` token (craft the base64 parts by hand);
      - `?access_token=<valid>` with no header.

  Run → FAIL.

- [ ] **Step 2: Implement.** Make the contract change, then run `pnpm --filter @eticket/contracts lint && pnpm --filter @eticket/contracts generate && pnpm --filter @eticket/contracts build`.
  Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/gateway packages/contracts
  git commit -m "feat(gateway): add backoffice login with bcrypt and HS256 JWT, guard the backoffice routes"
  ```

---

### Task 4: Rate limiting

**Files:**

- Create: `src/throttling/*`, `test/rate-limit.int-spec.ts`.
- Modify: `app.module.ts`, `auth.controller.ts`, `orders.controller.ts`, `health.controller.ts`.

**Interfaces:**

- `ThrottlerModule.forRootAsync` registers one named throttler, `default`, with `ttl: 60_000` and `limit: RATE_LIMIT_DEFAULT_PER_MIN`. Routes override it with `@Throttle`:
  - `POST /v1/orders` uses `RATE_LIMIT_ORDERS_PER_MIN`;
  - login uses `RATE_LIMIT_LOGIN_PER_MIN`.
- Health carries `@SkipThrottle()`.
- `ThrottlerGuard` is an `APP_GUARD`.
- The tracker is `req.ip`, which Express computes from `trust proxy`.
- On a `ThrottlerException`, a filter (or the nest-common envelope mapping) writes 429 `RATE_LIMITED` with the envelope and sets `Retry-After` to the seconds until the window resets, an integer of at least 1. Check whether nest-common already maps 429 to `RATE_LIMITED`; it does since Phase 3. Then only add `Retry-After`.
- The storage is in memory. That is fine for a single replica (spec §10).

- [ ] **Step 1: Write the failing tests.** Use separate `startGateway` instances with low limits.
  - **Orders:** `RATE_LIMIT_ORDERS_PER_MIN: '2'` → three `POST /v1/orders` give 2×(stub status) and then 429 with code `RATE_LIMITED` and a numeric `Retry-After` of at least 1.
  - **Login:** `RATE_LIMIT_LOGIN_PER_MIN: '2'` → the third login is 429, even when the credentials are right.
  - **Default:** `RATE_LIMIT_DEFAULT_PER_MIN: '3'` → the fourth `GET /v1/ticket-types` is 429.
  - **Health:** health is never limited (10 calls → all 200).
  - **Per-route buckets:** the orders limit does not consume the ticket-types budget.
  - **IP identity (Review Focus 5):**
    - With `TRUST_PROXY: '0'`, sending a different `X-Forwarded-For` on each request still hits the limit at the same count, so the header cannot reset the counter.
    - With `TRUST_PROXY: '1'`, two different `X-Forwarded-For` values each get their own full budget.

  Run → FAIL.

- [ ] **Step 2: Implement.** Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/gateway
  git commit -m "feat(gateway): rate limit per client IP with RATE_LIMITED envelopes and Retry-After"
  ```

---

### Task 5: Gateway contract suite, compose, smoke through the edge, docs, phase gate

**Files:**

- Create: `packages/contract-tests/src/gateway/{suite.ts,target.ts,health.contract.ts,shop.contract.ts,auth.contract.ts,backoffice.contract.ts,allow-list.contract.ts}`, `packages/contract-tests/test/gateway.contract-spec.ts`, `apps/gateway/test/contract.int-spec.ts`.
- Modify: `packages/contract-tests/{package.json (test:contract:gateway),README.md,src/index.ts}`, `infra/docker-compose.yml`, `infra/.env.example`, `infra/scripts/{contract.mjs,smoke.mjs,smoke.sh}`, `AGENTS.md`.

**Interfaces:**

- Produces:

  ```ts
  export interface GatewayContractTarget { baseUrl: string; adminEmail: string; adminPassword: string }
  export function gatewayTargetFromEnv(): GatewayContractTarget;   // CONTRACT_GATEWAY_BASE_URL, CONTRACT_ADMIN_EMAIL, CONTRACT_ADMIN_PASSWORD
  export function runGatewayContract(getTarget: () => GatewayContractTarget): void;
  ```

  The suite must stay under the production rate limits, so it can run against compose with default limits:
  - ≤ 4 order creations;
  - ≤ 6 logins;
  - ≤ 60 requests in total;
  - one shared JWT across the backoffice tests.

  It validates every 2xx body with `ContractValidator.load('gateway')`. Add `'gateway'` to `ServiceName` and bundle `gateway.yaml` if that is not done yet.

- [ ] **Step 1: Write the contract area.**
  - **`health.contract.ts`:** live is 200 and ready is 200.
  - **`shop.contract.ts`:**
    - `GET /v1/ticket-types` → 200, validated;
    - `POST /v1/orders` with GOLD×1 → 201, validated, then `GET /v1/orders/{id}` → 200;
    - a bad order body → 400 with a passed-through `VALIDATION_ERROR` envelope;
    - `POST /v1/payments` with a card and an `Idempotency-Key` → 201;
    - the same request again → 201 with `Idempotent-Replayed: true`;
    - `GET /v1/payments/{id}` → 200;
    - an unknown payment UUID → 404.
  - **`auth.contract.ts`:**
    - a good login → 200, validated against `login`;
    - a bad password → 401 `INVALID_CREDENTIALS`;
    - a bad body → 400.
  - **`backoffice.contract.ts`:**
    - each of the four routes with the token → 200, validated against its operation;
    - without a token → 401;
    - transactions with `pageSize=101` → 400, passed through.
  - **`allow-list.contract.ts`:** `GET /v1/transactions`, `/v1/journal-entries` and `/v1/accounts`, and `POST /v1/internal/postings` → 404.

  Runner 1 is `apps/gateway/test/contract.int-spec.ts`. It is in-process, with stubs that serve contract-valid bodies for every route. Build them by reusing the payment and ticket stub helpers, or minimal fixtures validated with `ContractValidator`.
  Runner 2 is `test:contract:gateway`.

- [ ] **Step 2: Compose and env.**
  - **Compose `gateway` service:** the shared `infra/docker/nest-service.Dockerfile` with `SERVICE=gateway` and `PORT=3000`.
    - `depends_on`: ticket, payment and ledger, all `service_healthy`.
    - Environment: `PORT`, the three service URLs (`http://ticket-service:3001` etc.), the three public keys, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH_B64`, `WEB_ORIGIN` (`http://localhost:5173`), `SWAGGER_ENABLED` (`'true'`), `LOG_LEVEL` and `TRUST_PROXY` (`'0'`).
    - `${VAR:?…}` on every secret.
    - Ports `127.0.0.1:3000:3000`; healthcheck `/health/ready`.
  - **`infra/.env.example`:**
    - placeholders for `JWT_SECRET` (with the `openssl rand -hex 32` note), `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH_B64`;
    - a comment: generate the hash with `node infra/scripts/admin-hash.mjs`.
    - Add `ADMIN_PASSWORD_DEV`, a **local-dev and smoke-only** plaintext admin password, with a comment: never set it in K3s or CI secrets other than for smoke.
  - **Appending to `infra/.env`. Never read or print `infra/.env`.** If keys are missing, append them without printing:
    - `JWT_SECRET` via `openssl rand -hex 32`;
    - generate a random admin password and keep it in a shell variable that is never echoed;
    - pipe it to `node infra/scripts/admin-hash.mjs --append infra/.env --email admin@eticketing.local`;
    - append `ADMIN_PASSWORD_DEV=<that password>` with `printf … >> infra/.env`.

    Do each only when the key is absent. Report the names appended.

- [ ] **Step 3: Contract runner and smoke through the edge.**
  - `contract.mjs` gains a `gateway` suite. It maps `CONTRACT_GATEWAY_BASE_URL` (default `http://127.0.0.1:3000`), `CONTRACT_ADMIN_EMAIL` ← `ADMIN_EMAIL` and `CONTRACT_ADMIN_PASSWORD` ← `ADMIN_PASSWORD_DEV`.
  - `smoke.mjs` now drives the shop flow **through the Gateway** at `:3000`, with no API keys.
    - It creates the order, pays by card, pays by QR and polls through the Gateway.
    - It then logs in with `ADMIN_EMAIL` / `ADMIN_PASSWORD_DEV`.
    - It checks the ledger entries and the accounts through `/v1/backoffice/*` with the JWT.
    - It checks the order status through the Gateway's `GET /v1/orders/{id}`.
    - The expected numbers are unchanged: both orders CONFIRMED, and 40000 debit and 40000 credit.
  - `smoke.sh` adds `gateway` to the `up` services.
  - Run on a fresh volume:

    ```bash
    docker compose -f infra/docker-compose.yml down -v
    docker compose -f infra/docker-compose.yml up -d --build --wait gateway
    infra/scripts/contract.sh gateway        # expect all pass
    infra/scripts/contract.sh ticket && infra/scripts/contract.sh payment && infra/scripts/contract.sh ledger
    docker compose -f infra/docker-compose.yml down -v && infra/scripts/smoke.sh    # expect SMOKE OK
    ```

    The ticket suite drains VIP, so run the gateway suite first. Its orders use GOLD.
  - Key-leak counts in the Gateway logs are 0 for each of the three public keys, `JWT_SECRET` and `ADMIN_PASSWORD_DEV`. Count only.

- [ ] **Step 4: Docs.**
  - **AGENTS.md Commands:**
    - Gateway: `test` (unit) and `test:int` (integration);
    - `node infra/scripts/admin-hash.mjs` to create the admin hash;
    - `infra/scripts/contract.sh gateway`.
  - **contract-tests README:** the gateway area and its env vars.
  - **Spec §7.1:** add the contract-tests gateway vars.

- [ ] **Step 5: Phase gate**, from a clean state:

  ```bash
  docker compose -f infra/docker-compose.yml down -v
  pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check
  infra/scripts/verify-db.sh && infra/scripts/smoke.sh
  ```

  Expected: everything passes, `DB OK` and `SMOKE OK`. Report per-suite counts.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/gateway packages/contract-tests infra AGENTS.md docs/spec.md
  git commit -m "feat(infra): add the gateway to compose and drive the smoke test through the edge"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-14-phase-6-gateway.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task, and a reviewer checks it before the next one starts. Tasks 2 and 3 (allow-list, header hygiene and JWT) get Opus reviewers.

**B — OpenCode hand-off (saves Claude tokens).** You are already on `phase-6-gateway`. From the repo root:

```bash
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-14-phase-6-gateway.md. \
You are on branch phase-6-gateway; do not switch or create branches. Execute the plan's tasks 1 \
to 5 in order. For each task follow every step exactly, write the failing test before the code, \
run every Run command and compare with Expected, and make the commit given in the task. Never \
read or print infra/.env; only append missing keys as Task 5 shows. Never log or echo a password, \
JWT secret or API key. Add only @nestjs/jwt and bcryptjs as new dependencies (plus the listed \
@nestjs/throttler and helmet), pinned exactly. Edit packages/contracts/openapi only where Task 3 \
says. If a verification still fails after two fix attempts, stop and report the task, the command \
and its full output; never skip or weaken a test. Finish by printing each task's commit hash and \
the full Task 5 phase-gate output."
```

**After either option**, back in Claude Code (Opus):

- a whole-branch review on Opus, then one fix wave;
- the EGM drift check against spec §2.2, §4.6, §6 and §7;
- the phase summary.
