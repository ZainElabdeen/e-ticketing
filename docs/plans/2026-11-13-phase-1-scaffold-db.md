# Phase 1 — Monorepo Scaffold, Postgres and Migrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm + Turborepo monorepo with shared config, generated contract types, a Postgres 18 bootstrap (schemas + roles), hand-written SQL migrations for the `tickets`, `payments` and `ledger` schemas proven by Testcontainers integration tests, and a docker-compose stack that boots Postgres and applies all migrations.

**Architecture:** No NestJS code in this phase. Each backend app (`apps/ticket-service`, `apps/payment-service`, `apps/ledger-service`) is a *migration shell*: `package.json`, `prisma.config.ts`, `prisma/` with SQL migrations, and integration tests. Migrations are SQL-first (decided 2026-11-13, recorded as ADR-0015 in Task 4): hand-written `migration.sql`, applied only with `prisma migrate deploy`, never `prisma migrate dev`. A shared `@eticket/testing` package starts a Postgres container with the same init script compose uses.

**Tech Stack:** Node 26 LTS, pnpm 10, Turborepo 2, TypeScript, ESLint 9 (flat config) + typescript-eslint 8, Prettier 3, Prisma 7 (CLI only in this phase), PostgreSQL 18, Jest 30 + ts-jest, `@testcontainers/postgresql` 11, `pg` 8, `openapi-typescript` 7, `@redocly/cli`, Docker Compose v2.

**Spec:** [docs/spec.md](../spec.md) — §3 (data model) and §9 (deployment: bootstrap, migrations). Rules: [AGENTS.md](../../AGENTS.md). Contracts: [packages/contracts/](../../packages/contracts/).

**Branch:** create `phase-1-scaffold` from `phase-0-spec` before Task 1:
`git switch phase-0-spec && git switch -c phase-1-scaffold`.

## Global Constraints

- Node `26` (`.nvmrc` = `26`, `engines.node` = `>=26`); Docker images `node:26-alpine`, `postgres:18-alpine`.
- Versions: resolve each listed major to its latest stable release at execution time (`npm view <pkg>@<major> version`) and pin it exactly (no `^`/`~`) in `package.json`. pnpm is pinned via the root `packageManager` field.
- Package scope `@eticket/*`. Workspaces: `apps/*`, `packages/*`.
- Database `eticketing`. Schemas `tickets`, `payments`, `ledger`. Roles per schema: `<schema>_owner` (owns schema, runs migrations) and `<schema>_app` (DML only). No cross-schema foreign keys or grants.
- Money: `bigint` columns named `*_minor` + `currency char(3) NOT NULL DEFAULT 'AED'`. Primary keys `uuid DEFAULT gen_random_uuid()`. Timestamps `timestamptz`.
- Every SQL object is schema-qualified (`tickets.ticket_types`, never bare `ticket_types`).
- Migrations: SQL-first. Never run `prisma migrate dev`. Apply only with `prisma migrate deploy`.
- Secrets: commit only `.env.example`. Never create, read or print a real `.env` in commits or logs. Tests use the fixed throwaway password `test-password`.
- Postgres 18 image: mount the data volume at `/var/lib/postgresql` (not `/var/lib/postgresql/data` — the 18 image refuses to start with the old path).
- Commits: conventional (`feat:`, `chore:`, `test:`, `docs:`), one per task, message given in each task.
- Integration test files: `test/**/*.int-spec.ts`, run by `pnpm test:int`; Docker must be running.
- Postgres error codes used in assertions: `23505` unique_violation, `23514` check_violation, `23503` foreign_key_violation, `42501` insufficient_privilege, `22P02` invalid_text_representation.

## Review Focus

1. **Journal entry with zero lines** — a trigger on `journal_lines` alone never fires; the entry must still be rejected at COMMIT. Test in Task 6.
2. **Migrations re-run** (container restart, `compose up` twice) must be a no-op, not an error. Verified in Task 7.
3. **Compose started without `infra/.env`** must fail fast with a message naming the missing variable, not boot Postgres with empty passwords. Verified in Task 3.
4. **Runtime (`_app`) roles running DDL or reading another service's schema** must be denied (`42501`). Tests in Task 3.
5. **Concurrent reservations at the quota edge** must never oversell (`sold + reserved` never exceeds `quota`). Test in Task 4.

---

## File Structure

```text
package.json                     root scripts, packageManager, devDeps (turbo, eslint, prettier, typescript)
pnpm-workspace.yaml              apps/*, packages/*
turbo.json                       tasks: build, lint, test, test:int
.nvmrc  .npmrc  .editorconfig  .prettierrc.json  .prettierignore
eslint.config.mjs                root flat config → @eticket/config
packages/config/                 shared tsconfig, eslint, jest presets
  package.json  tsconfig.base.json  tsconfig.node.json  eslint.config.mjs  jest.integration.cjs
packages/contracts/              (exists) + package.json, tsconfig.json, src/index.ts, src/generated/*.ts
packages/testing/                Testcontainers Postgres helper shared by all DB tests
  package.json  tsconfig.json  src/index.ts  src/postgres.ts  test/bootstrap.int-spec.ts  jest.config.cjs
infra/postgres/init/00-roles.sh  creates schemas + roles (compose, tests, later K3s Job)
infra/migrate/Dockerfile         one image per service that runs `prisma migrate deploy`
infra/docker-compose.yml         postgres + migrate-tickets / migrate-payments / migrate-ledger
infra/.env.example               every variable compose needs, placeholder values
infra/scripts/verify-db.sh       boots compose, checks migrations and seeds, re-runs migrations
apps/<service>/                  ticket-service | payment-service | ledger-service
  package.json  tsconfig.json  jest.config.cjs  prisma.config.ts
  prisma/schema.prisma  prisma/migrations/migration_lock.toml
  prisma/migrations/20261113000000_init/migration.sql
  test/schema.int-spec.ts
docs/adr/0015-sql-first-migrations.md
AGENTS.md                        Commands section updated (Task 7)
```

---

### Task 1: Root workspace and shared config

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.npmrc`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.mjs`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/tsconfig.node.json`, `packages/config/eslint.config.mjs`, `packages/config/jest.integration.cjs`
- Modify: `.gitignore` (append `node_modules/`, `.turbo/`, `dist/`, `coverage/`)

**Interfaces:**
- Produces: package `@eticket/config` with exports
  `"./tsconfig.base.json"`, `"./tsconfig.node.json"`, `"./eslint"` (→ `eslint.config.mjs`, default export: flat-config array), `"./jest-integration"` (→ `jest.integration.cjs`).
- Produces: root scripts `lint`, `build`, `test`, `test:int`, `format`, `format:check` — each `turbo run <task>` except the two format scripts (`prettier --write .` / `prettier --check .`).

- [ ] **Step 1: Write root files**

  - `package.json`: `"private": true`, `"name": "e-ticketing"`, `"packageManager": "pnpm@<pinned 10.x>"`, `"engines": {"node": ">=26"}`, scripts as in Interfaces, devDependencies `turbo@2`, `typescript`, `eslint@9`, `typescript-eslint@8`, `@eslint/js@9`, `prettier@3`, `@eticket/config: "workspace:*"`.
  - `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]`.
  - `turbo.json` (`$schema` `https://turborepo.com/schema.json`): `build` → `dependsOn: ["^build"]`, `outputs: ["dist/**"]`; `lint` → `dependsOn: ["^build"]`; `test` → `dependsOn: ["^build"]`; `test:int` → `dependsOn: ["^build"]`, `cache: false`.
  - `.npmrc`: `engine-strict=true`.
  - `.prettierrc.json`: `{"singleQuote": true, "printWidth": 100}`. `.prettierignore`: `pnpm-lock.yaml`, `packages/contracts/src/generated`, `**/migration.sql`.

- [ ] **Step 2: Write `packages/config`**

  - `tsconfig.base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `target: "ES2023"`, `lib: ["ES2023"]`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `esModuleInterop: true`, `skipLibCheck: true`, `isolatedModules: true`.
  - `tsconfig.node.json`: extends `./tsconfig.base.json`, `types: ["node", "jest"]`.
  - `eslint.config.mjs`: `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked` with `parserOptions.projectService: true`; ignores `dist`, `coverage`, `**/generated/**`.
  - `jest.integration.cjs`: `module.exports = { preset: 'ts-jest', testEnvironment: 'node', testMatch: ['<rootDir>/test/**/*.int-spec.ts'], testTimeout: 180000, maxWorkers: 1 }`. Add `ts-jest@29+`, `jest@30`, `@types/jest`, `@types/node` as dependencies of `@eticket/config` so consumers get them.

- [ ] **Step 3: Install and verify the workspace resolves**

  Run: `corepack enable && pnpm install`
  Expected: completes, creates `pnpm-lock.yaml`, no `ERR_PNPM_UNSUPPORTED_ENGINE`.

  Run: `pnpm turbo run lint --dry=json | head -c 200`
  Expected: valid JSON (turbo parses `turbo.json`).

  Run: `pnpm format:check`
  Expected: exits 0 (fix with `pnpm format` if the new files are not formatted).

- [ ] **Step 4: Commit**

  ```bash
  git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json .nvmrc .npmrc .editorconfig .prettierrc.json .prettierignore eslint.config.mjs .gitignore packages/config
  git commit -m "chore: scaffold pnpm + turborepo workspace and shared config"
  ```

---

### Task 2: Contracts package — lint and generated types

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Create (generated, committed): `packages/contracts/src/generated/{gateway,ticket-service,payment-service,ledger-service}.ts`
- Modify: `packages/contracts/README.md` (Commands section → the pnpm scripts below)

**Interfaces:**
- Consumes: `@eticket/config/tsconfig.base.json`.
- Produces: package `@eticket/contracts`, `"exports": {".": "./src/index.ts"}`, re-exporting namespaces:
  `export type * as Gateway from './generated/gateway.js'` (likewise `TicketService`, `PaymentService`, `LedgerService`). Later phases import `paths`/`components` from these.
- Produces scripts: `lint` (`redocly lint openapi/ticket-service.yaml openapi/payment-service.yaml openapi/ledger-service.yaml openapi/gateway.yaml`), `generate` (one `openapi-typescript openapi/<name>.yaml -o src/generated/<name>.ts` per file, chained with `&&`), `check:generated` (`pnpm generate && git diff --exit-code -- src/generated`), `build` (`tsc -p tsconfig.json --noEmit`).

- [ ] **Step 1: Write `package.json` and `tsconfig.json`**

  devDependencies: `@redocly/cli` (pinned), `openapi-typescript@7`, `typescript`, `@eticket/config`. `tsconfig.json` extends `@eticket/config/tsconfig.base.json`, `include: ["src"]`.

- [ ] **Step 2: Verify generation fails before it exists**

  Run: `pnpm --filter @eticket/contracts build`
  Expected: FAIL — `src/index.ts` imports missing `./generated/*.js` modules.

- [ ] **Step 3: Generate types and write `src/index.ts`**

  Run: `pnpm --filter @eticket/contracts generate`
  Expected: four files in `src/generated/`, each containing `export interface paths`. External `$ref`s into `common.yaml` must resolve (no `Can't resolve $ref` error).

- [ ] **Step 4: Verify**

  Run: `pnpm --filter @eticket/contracts lint && pnpm --filter @eticket/contracts build && pnpm --filter @eticket/contracts check:generated`
  Expected: Redocly prints `Your API descriptions are valid`; `tsc` exits 0; `git diff --exit-code` exits 0 after the files are staged (stage them first: `git add packages/contracts/src/generated`).

- [ ] **Step 5: Commit**

  ```bash
  git add packages/contracts
  git commit -m "feat(contracts): add lint and generated TypeScript types"
  ```

---

### Task 3: Postgres bootstrap, test helper and compose database

**Files:**
- Create: `infra/postgres/init/00-roles.sh` (executable)
- Create: `infra/docker-compose.yml` (service `postgres` only in this task), `infra/.env.example`
- Create: `packages/testing/package.json`, `packages/testing/tsconfig.json`, `packages/testing/jest.config.cjs`, `packages/testing/src/index.ts`, `packages/testing/src/postgres.ts`
- Test: `packages/testing/test/bootstrap.int-spec.ts`

**Interfaces:**
- Produces `infra/postgres/init/00-roles.sh`: bash, `set -euo pipefail`, runs `psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"`. Requires env vars `TICKETS_OWNER_PASSWORD`, `TICKETS_APP_PASSWORD`, `PAYMENTS_OWNER_PASSWORD`, `PAYMENTS_APP_PASSWORD`, `LEDGER_OWNER_PASSWORD`, `LEDGER_APP_PASSWORD` (fail with `: "${VAR:?VAR is required}"` if missing). Passwords are passed as psql variables (`-v name="$VAR"`) and used as `:'name'`, never string-interpolated into SQL. For each schema `s` in `tickets payments ledger`:
  ```sql
  CREATE ROLE s_owner LOGIN PASSWORD :'s_owner_pw';
  CREATE ROLE s_app   LOGIN PASSWORD :'s_app_pw';
  CREATE SCHEMA s AUTHORIZATION s_owner;
  REVOKE ALL ON SCHEMA s FROM PUBLIC;
  GRANT USAGE ON SCHEMA s TO s_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE s_owner IN SCHEMA s
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO s_app;
  ALTER ROLE s_owner SET search_path = s;
  ALTER ROLE s_app   SET search_path = s;
  ```
  plus once: `REVOKE ALL ON DATABASE eticketing FROM PUBLIC; GRANT CONNECT ON DATABASE eticketing TO <all six roles>;`.
- Produces `@eticket/testing` (`"exports": {".": "./src/index.ts"}`; scripts `lint` = `eslint .`, `build` = `tsc -p tsconfig.json --noEmit`, `test:int` = `jest -c jest.config.cjs`; `tsconfig.json` extends `@eticket/config/tsconfig.node.json` with `include: ["src", "test"]`), deps `@testcontainers/postgresql@11`, `pg@8`, `@types/pg`:
  ```ts
  export type Schema = 'tickets' | 'payments' | 'ledger';
  export type AppName = 'ticket-service' | 'payment-service' | 'ledger-service';
  export type Role = `${Schema}_owner` | `${Schema}_app`;
  export const SCHEMA_OF: Record<AppName, Schema>;          // ticket-service→tickets, payment-service→payments, ledger-service→ledger
  export const TEST_PASSWORD = 'test-password';
  export interface TestDatabase {
    urlFor(role: Role | 'postgres'): string;               // postgresql://<role>:<pw>@<host>:<port>/eticketing (owner/app URLs add ?schema=<schema>)
    connectAs(role: Role | 'postgres'): Promise<pg.Client>; // connected client; caller ends it
    stop(): Promise<void>;
  }
  export function startTestDatabase(): Promise<TestDatabase>;
  export function applyMigrations(db: TestDatabase, app: AppName): void;
  ```
  `startTestDatabase` starts `postgres:18-alpine` via `PostgreSqlContainer` with database `eticketing`, user `postgres`, password `TEST_PASSWORD`, all six role-password env vars = `TEST_PASSWORD`, and `infra/postgres/init/00-roles.sh` copied to `/docker-entrypoint-initdb.d/00-roles.sh` (mode `0o755`). Resolve repo root as `path.resolve(__dirname, '../../..')`.
  `applyMigrations` runs `execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { cwd: <root>/apps/<app>, env: { ...process.env, MIGRATION_DATABASE_URL: db.urlFor(`${SCHEMA_OF[app]}_owner`) }, stdio: 'pipe' })`.

- [ ] **Step 1: Write the failing test `packages/testing/test/bootstrap.int-spec.ts`**

  One `startTestDatabase()` in `beforeAll`, `stop()` in `afterAll`. Tests:
  ```ts
  it('creates three schemas owned by their owner roles', async () => {
    // SELECT nspname, pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN ('tickets','payments','ledger') ORDER BY 1
    expect(rows).toEqual([
      { nspname: 'ledger', owner: 'ledger_owner' },
      { nspname: 'payments', owner: 'payments_owner' },
      { nspname: 'tickets', owner: 'tickets_owner' },
    ]);
  });
  it('lets each role log in', ...)            // connectAs for all six roles resolves
  it('denies app roles DDL in their own schema', ...)
    // as tickets_app: CREATE TABLE tickets.x (id int) → rejects { code: '42501' }
  it('denies app roles access to other schemas', ...)
    // as postgres: SELECT has_schema_privilege('tickets_app','payments','USAGE') → false; and for every (app role, foreign schema) pair
  it('grants app roles DML on tables the owner creates later', ...)
    // as tickets_owner: CREATE TABLE tickets.probe (id int); as tickets_app: INSERT INTO tickets.probe VALUES (1) succeeds; as tickets_owner: DROP TABLE tickets.probe
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm --filter @eticket/testing test:int`
  Expected: FAIL — `Cannot find module '../src'` (helper not written yet).

- [ ] **Step 3: Implement `00-roles.sh`, `src/postgres.ts`, `src/index.ts`**

  As specified in Interfaces. `chmod +x infra/postgres/init/00-roles.sh`. The script lives in `infra/` because compose, the tests and the Phase 9 K3s Job all run it.

- [ ] **Step 4: Run to verify it passes**

  Run: `pnpm --filter @eticket/testing test:int`
  Expected: PASS, 5 tests.

- [ ] **Step 5: Write `infra/docker-compose.yml` (postgres only) and `infra/.env.example`**

  - `name: eticketing`. Service `postgres`: `image: postgres:18-alpine`; environment `POSTGRES_DB: eticketing`, `POSTGRES_USER: postgres`, `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in infra/.env}` and each role password the same way (`${TICKETS_OWNER_PASSWORD:?…}` etc.); volumes `pgdata:/var/lib/postgresql` and `./postgres/init:/docker-entrypoint-initdb.d:ro`; ports `"5432:5432"`; healthcheck `["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres -d eticketing"]`, interval 5s, retries 20 (TCP `-h 127.0.0.1` so it stays unhealthy while the init scripts run on the socket-only temporary server). Top-level `volumes: { pgdata: {} }`.
  - `.env.example`: all seven variables with value `change-me`, plus a comment: copy to `infra/.env`; init runs only on an empty volume — after changing passwords run `docker compose -f infra/docker-compose.yml down -v`.

- [ ] **Step 6: Verify fail-fast and boot**

  Run (no `infra/.env` present): `docker compose -f infra/docker-compose.yml config >/dev/null`
  Expected: FAIL with `required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in infra/.env`.

  Run: `cp infra/.env.example infra/.env && docker compose -f infra/docker-compose.yml up -d --wait postgres && docker compose -f infra/docker-compose.yml exec postgres psql -U postgres -d eticketing -tAc "SELECT string_agg(nspname, ',' ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('tickets','payments','ledger')"`
  Expected: `ledger,payments,tickets`.

  Run: `docker compose -f infra/docker-compose.yml down -v`
  Expected: containers and `pgdata` volume removed. (`infra/.env` stays local; it is gitignored.)

- [ ] **Step 7: Commit**

  ```bash
  git add infra/postgres infra/docker-compose.yml infra/.env.example packages/testing pnpm-lock.yaml
  git commit -m "feat(infra): add postgres bootstrap roles, compose database and test helper"
  ```

---

### Task 4: `tickets` schema migration (Ticket Service shell) + ADR-0015

**Files:**
- Create: `apps/ticket-service/package.json`, `tsconfig.json`, `jest.config.cjs`, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20261113000000_init/migration.sql`
- Test: `apps/ticket-service/test/schema.int-spec.ts`
- Create: `docs/adr/0015-sql-first-migrations.md`; Modify: `docs/spec.md` §13 (add ADR-0015 row)

**Interfaces:**
- Consumes: `startTestDatabase`, `applyMigrations`, `TestDatabase.connectAs` from `@eticket/testing`; `@eticket/config/jest-integration`.
- Produces (pattern reused by Tasks 5–6):
  - `package.json`: name `@eticket/ticket-service`, `private`, scripts `test:int` (`jest -c jest.config.cjs`), `lint` (`eslint .`), `prisma:deploy` (`prisma migrate deploy`); devDependencies `prisma@7` (pinned), `@eticket/testing`, `@eticket/config`.
  - `prisma.config.ts`:
    ```ts
    import { defineConfig, env } from 'prisma/config';
    export default defineConfig({
      schema: 'prisma/schema.prisma',
      migrations: { path: 'prisma/migrations' },
      datasource: { url: env('MIGRATION_DATABASE_URL') },
    });
    ```
    The CLI always connects as the owner role. (Check this against the current Prisma 7 config reference before writing; keep the same intent if the API names differ.)
  - `prisma/schema.prisma`: only `datasource db { provider = "postgresql" }` and a comment: models are added in Phase 2 via `prisma db pull`; never run `prisma migrate dev`.
  - `migration_lock.toml`: `provider = "postgresql"`.
  - `jest.config.cjs`: `module.exports = require('@eticket/config/jest-integration');`
  - `tsconfig.json`: extends `@eticket/config/tsconfig.node.json`, `include: ["test", "prisma.config.ts"]`; add script `build` = `tsc -p tsconfig.json --noEmit`.

- [ ] **Step 1: Write the failing test `apps/ticket-service/test/schema.int-spec.ts`**

  `beforeAll`: `db = await startTestDatabase(); applyMigrations(db, 'ticket-service'); app = await db.connectAs('tickets_app')`. Helper `insertOrder(status, extra)` inserts into `tickets.orders` with `total_minor 10000`, `expires_at now() + interval '15 minutes'`. Tests (exact values):
  ```ts
  it('seeds the three ticket types', ...)
    // SELECT code, name, price_minor, currency, quota, sold, reserved FROM tickets.ticket_types ORDER BY price_minor
    // → [{GOLD,'Gold','10000','AED',100,0,0}, {PREMIUM,'Premium','20000','AED',100,0,0}, {VIP,'VIP','50000','AED',100,0,0}]  (bigint returns as string from pg)
  it('rejects sold + reserved above quota', ...)
    // UPDATE ... SET reserved = 101 WHERE code='GOLD' → { code: '23514' }
  it('conditional reservation UPDATE stops at the quota edge', ...)
    // in a transaction (rolled back): SET sold = 95 WHERE code='GOLD';
    // spec §4.1 UPDATE with $qty=6 → rowCount 0; with $qty=5 → rowCount 1
  it('never oversells under 20 concurrent reservations of 10', ...)
    // reset GOLD sold=0,reserved=0; 20 separate tickets_app clients run the spec §4.1 UPDATE (qty 10) in parallel via Promise.all
    // → exactly 10 rowCount=1; final reserved = 100; then reset reserved = 0
  it('ties CONFIRMED to confirmed_at and paid_transaction_id', ...)
    // status CONFIRMED without paid_transaction_id → 23514; PENDING with confirmed_at → 23514;
    // CONFIRMED with both set → ok
  it('rejects order statuses outside PENDING/CONFIRMED/EXPIRED', ...)   // 'CANCELLED' → 23514
  it('keeps paid_transaction_id unique', ...)                         // two CONFIRMED orders, same uuid → 23505
  it('validates order items', ...)
    // quantity 11 → 23514; line_total_minor != unit_price_minor*quantity → 23514;
    // same (order_id, ticket_type_id) twice → 23505
  it('blocks deleting a ticket type that has order items', ...)        // as tickets_owner: DELETE FROM tickets.ticket_types WHERE code='GOLD' → 23503
  it('denies tickets_app access to the payments schema', ...)         // SELECT 1 FROM payments.payments → 42501 (schema exists, no USAGE)
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm install && pnpm --filter @eticket/ticket-service test:int`
  Expected: FAIL — `relation "tickets.ticket_types" does not exist` (or "No migration found").

- [ ] **Step 3: Write `prisma/migrations/20261113000000_init/migration.sql`**

  Implement spec §3.1 exactly, schema-qualified, with: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` on all three tables; `created_at timestamptz NOT NULL DEFAULT now()`; `orders.expires_at` without default; the `orders` CHECK from the spec verbatim; indexes `orders (status, expires_at)`, `orders (created_at)`, `order_items (order_id)`; `UNIQUE (paid_transaction_id)`; FKs `order_items.order_id → orders(id)` and `order_items.ticket_type_id → ticket_types(id)` with default `NO ACTION`. Seed at the end:
  ```sql
  INSERT INTO tickets.ticket_types (code, name, price_minor, quota) VALUES
    ('GOLD', 'Gold', 10000, 100), ('PREMIUM', 'Premium', 20000, 100), ('VIP', 'VIP', 50000, 100);
  ```

- [ ] **Step 4: Run to verify it passes**

  Run: `pnpm --filter @eticket/ticket-service test:int`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Write ADR-0015 `docs/adr/0015-sql-first-migrations.md`**

  Same four headings as the other ADRs. Context: spec needs CHECKs, a partial unique index, deferred constraint triggers and per-role grants; Prisma's schema language cannot express most of these, and a later `migrate dev` can silently drop hand-added SQL (prisma/prisma#24180). Decision: hand-written `migration.sql` is the single source of truth; apply with `prisma migrate deploy` as the owner role; never `migrate dev`; `schema.prisma` models generated with `prisma db pull` in Phase 2 for the client only; the .NET port maps the same tables. Alternatives: Prisma schema-first with `--create-only` edits; a plain SQL runner such as dbmate (would need a new tool). Trade-off: every schema change is a hand-written `ALTER`; no generated migrations. Add the row `| [0015](./adr/0015-sql-first-migrations.md) | SQL-first migrations, applied with prisma migrate deploy | Prisma schema-first |` to spec §13.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/ticket-service docs/adr/0015-sql-first-migrations.md docs/spec.md pnpm-lock.yaml
  git commit -m "feat(ticket-service): add tickets schema migration with quota constraints and seed"
  ```

---

### Task 5: `payments` schema migration (Payment Service shell)

**Files:**
- Create: `apps/payment-service/{package.json,tsconfig.json,jest.config.cjs,prisma.config.ts}`, `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20261113000000_init/migration.sql`
- Test: `apps/payment-service/test/schema.int-spec.ts`

**Interfaces:**
- Consumes: same as Task 4; files follow Task 4's pattern with name `@eticket/payment-service`.

- [ ] **Step 1: Write the failing test `apps/payment-service/test/schema.int-spec.ts`**

  Connect as `payments_app`. Helper `insertPayment(orderId, status, method = 'QR')` with `amount_minor 10000`. Tests:
  ```ts
  it('allows only one PENDING or SUCCEEDED payment per order', ...)
    // PENDING then second PENDING, same order → 23505; SUCCEEDED then PENDING → 23505
  it('frees the order after cancellation', ...)
    // PENDING → UPDATE status='CANCELLED', cancelled_at=now() → new PENDING for same order succeeds
  it('rejects payment statuses outside PENDING/SUCCEEDED/CANCELLED', ...)   // 'FAILED' → 23514
  it('rejects non-positive amounts and unknown methods', ...)               // amount_minor 0 → 23514; method 'CRYPTO' → 23514
  it('keeps one transaction per payment and unique references', ...)
    // second transactions row for same payment_id → 23505; same payment_reference → 23505
  it('requires idempotency response status and body together', ...)
    // response_status 201 with response_body NULL → 23514; both NULL → ok; both set → ok
  it('rejects outbox statuses outside PENDING/DONE/FAILED', ...)            // 'PROCESSING' → 23514
  it('rejects unknown confirm outcomes', ...)                               // confirm_outcome 'MAYBE' → 23514
  it('denies payments_app access to the ledger schema', ...)               // SELECT 1 FROM ledger.accounts → 42501
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm install && pnpm --filter @eticket/payment-service test:int`
  Expected: FAIL — `relation "payments.payments" does not exist`.

- [ ] **Step 3: Write `migration.sql`**

  Implement spec §3.2 exactly, schema-qualified. Pinned details the spec leaves open:
  - Partial unique index: `CREATE UNIQUE INDEX payments_one_live_per_order ON payments.payments (order_id) WHERE status IN ('PENDING','SUCCEEDED');`
  - `idempotency_keys`: `CHECK (char_length(key) BETWEEN 8 AND 128)`, `CHECK ((response_status IS NULL) = (response_body IS NULL))`, `payment_id` FK → `payments.payments(id)`.
  - `outbox_events`: `type text NOT NULL CHECK (type IN ('payment.succeeded'))`; index `(status, next_attempt_at)`.
  - Indexes: `payments (status, succeed_after)`, `payments (order_id)`, `payments (created_at)`, `transactions (created_at)`.
  - No seed data.

- [ ] **Step 4: Run to verify it passes**

  Run: `pnpm --filter @eticket/payment-service test:int`
  Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/payment-service pnpm-lock.yaml
  git commit -m "feat(payment-service): add payments schema migration with one-live-payment index"
  ```

---

### Task 6: `ledger` schema migration (Ledger Service shell)

**Files:**
- Create: `apps/ledger-service/{package.json,tsconfig.json,jest.config.cjs,prisma.config.ts}`, `prisma/schema.prisma`, `prisma/migrations/migration_lock.toml`, `prisma/migrations/20261113000000_init/migration.sql`
- Test: `apps/ledger-service/test/schema.int-spec.ts`

**Interfaces:**
- Consumes: same as Task 4; name `@eticket/ledger-service`.

- [ ] **Step 1: Write the failing test `apps/ledger-service/test/schema.int-spec.ts`**

  Connect as `ledger_app`. Helper `postEntry(client, lines: Array<[accountCode, 'DEBIT'|'CREDIT', amount]>, opts?)` runs `BEGIN`, inserts one `journal_entries` row (`posting_type 'TICKET_SALE'`, `currency 'AED'`, random `transaction_id`/`order_id`, `payment_reference 'PAY-20261113-7F3K9Q'`, `description 'test'`), inserts the lines (account by code), then `COMMIT`; on error runs `ROLLBACK` and rethrows. Tests:
  ```ts
  it('seeds the chart of accounts', ...)
    // SELECT code, name, type, currency FROM ledger.accounts ORDER BY code
    // → [['1100','Payment Gateway Clearing','ASSET','AED'], ['2100','Customer Refunds Payable','LIABILITY','AED'], ['4000','Ticket Sales Revenue','REVENUE','AED']]
  it('commits a balanced entry', ...)               // [['1100','DEBIT',70000],['4000','CREDIT',70000]] → resolves
  it('rejects an unbalanced entry at commit', ...)  // [['1100','DEBIT',70000],['4000','CREDIT',60000]] → rejects { code: '23514', message: /unbalanced/ }
  it('rejects an entry with one line', ...)         // [['1100','DEBIT',70000]] → rejects { code: '23514', message: /fewer than 2 lines/ }
  it('rejects an entry with no lines', ...)         // [] → rejects { code: '23514', message: /fewer than 2 lines/ }   (Review Focus 1)
  it('rejects a line in another currency', ...)
    // as ledger_owner: INSERT account ('9999','Test USD','ASSET','USD'); entry AED with [['9999','DEBIT',100],['4000','CREDIT',100]] → { code: '23514', message: /currency/ }
  it('allows one entry per transaction_id', ...)    // two balanced entries, same transaction_id → 23505
  it('rejects unknown posting types', ...)          // posting_type 'REFUND' → 23514
  it('is append-only for ledger_app', ...)
    // after a balanced entry: UPDATE ledger.journal_lines SET amount_minor = 1 → 42501;
    // DELETE FROM ledger.journal_entries → 42501; UPDATE ledger.journal_entries SET description='x' → 42501
  it('denies ledger_app access to the tickets schema', ...)   // SELECT 1 FROM tickets.orders → 42501
  ```

- [ ] **Step 2: Run to verify it fails**

  Run: `pnpm install && pnpm --filter @eticket/ledger-service test:int`
  Expected: FAIL — `relation "ledger.accounts" does not exist`.

- [ ] **Step 3: Write `migration.sql`**

  Implement spec §3.3 tables exactly, schema-qualified; `journal_entries.currency char(3) NOT NULL` (no default); indexes `journal_entries (posted_at)`, `journal_lines (journal_entry_id)`, `journal_lines (account_id)`. Seed:
  ```sql
  INSERT INTO ledger.accounts (code, name, type) VALUES
    ('1100', 'Payment Gateway Clearing', 'ASSET'),
    ('2100', 'Customer Refunds Payable', 'LIABILITY'),
    ('4000', 'Ticket Sales Revenue', 'REVENUE');
  ```
  Balance check — one function, two deferred constraint triggers (so an entry with zero lines is still checked):
  ```sql
  CREATE FUNCTION ledger.assert_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE
    v_entry uuid; v_lines int; v_debit bigint; v_credit bigint; v_currency_ok boolean;
  BEGIN
    IF TG_TABLE_NAME = 'journal_entries' THEN v_entry := NEW.id; ELSE v_entry := NEW.journal_entry_id; END IF;
    SELECT count(l.id),
           coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'DEBIT'), 0),
           coalesce(sum(l.amount_minor) FILTER (WHERE l.direction = 'CREDIT'), 0),
           coalesce(bool_and(a.currency = e.currency), true)
      INTO v_lines, v_debit, v_credit, v_currency_ok
      FROM ledger.journal_entries e
      LEFT JOIN ledger.journal_lines l ON l.journal_entry_id = e.id
      LEFT JOIN ledger.accounts a ON a.id = l.account_id
     WHERE e.id = v_entry;
    IF v_lines < 2 THEN
      RAISE EXCEPTION 'journal entry % has fewer than 2 lines', v_entry USING ERRCODE = 'check_violation';
    END IF;
    IF NOT v_currency_ok THEN
      RAISE EXCEPTION 'journal entry % has a line whose account currency differs from the entry currency', v_entry USING ERRCODE = 'check_violation';
    END IF;
    IF v_debit <> v_credit THEN
      RAISE EXCEPTION 'journal entry % is unbalanced: debits % credits %', v_entry, v_debit, v_credit USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END $$;

  CREATE CONSTRAINT TRIGGER journal_entries_balanced AFTER INSERT ON ledger.journal_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();
  CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON ledger.journal_lines
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_balanced();
  ```
  Append-only, last statements of the migration (default privileges from Task 3 granted UPDATE/DELETE on every new table):
  ```sql
  REVOKE UPDATE, DELETE, TRUNCATE ON ledger.journal_entries, ledger.journal_lines FROM ledger_app;
  ```

- [ ] **Step 4: Run to verify it passes**

  Run: `pnpm --filter @eticket/ledger-service test:int`
  Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/ledger-service pnpm-lock.yaml
  git commit -m "feat(ledger-service): add ledger schema migration with balance trigger and append-only grants"
  ```

---

### Task 7: Compose migrate containers, verify script, Commands docs

**Files:**
- Create: `infra/migrate/Dockerfile`, `infra/scripts/verify-db.sh` (executable), `.dockerignore`
- Modify: `infra/docker-compose.yml` (add three migrate services), `AGENTS.md` (Commands section)

**Interfaces:**
- Consumes: each app's `prisma.config.ts` + `prisma/` from Tasks 4–6; `infra/.env` variables from Task 3.
- Produces `infra/migrate/Dockerfile`: `FROM node:26-alpine`; `ARG SERVICE`; `ARG PRISMA_VERSION` (must equal the version pinned in `apps/*/package.json`); `WORKDIR /app`; `RUN npm init -y >/dev/null && npm install --omit=dev prisma@${PRISMA_VERSION}`; `COPY apps/${SERVICE}/prisma.config.ts ./`; `COPY apps/${SERVICE}/prisma ./prisma`; `USER node`; `CMD ["npx", "prisma", "migrate", "deploy"]`. Build context is the repo root.
- Produces compose services `migrate-tickets`, `migrate-payments`, `migrate-ledger`: `build: { context: .., dockerfile: infra/migrate/Dockerfile, args: { SERVICE: <app>, PRISMA_VERSION: <pinned> } }`; `environment: MIGRATION_DATABASE_URL: postgresql://<schema>_owner:${<SCHEMA>_OWNER_PASSWORD}@postgres:5432/eticketing?schema=<schema>`; `depends_on: { postgres: { condition: service_healthy } }`; `restart: "no"`. Later phases make each service `depends_on` its migrate container with `condition: service_completed_successfully`.
- Produces `infra/scripts/verify-db.sh`: bash, `set -euo pipefail`, `cd "$(dirname "$0")/.."`; `docker compose up -d --build --wait postgres`; runs `docker compose run --rm migrate-tickets`, `migrate-payments`, `migrate-ledger` **twice each** (second run must also exit 0 — Review Focus 2); then via `docker compose exec -T postgres psql -U postgres -d eticketing -tAc` asserts `SELECT count(*) FROM tickets.ticket_types` = `3`, `SELECT count(*) FROM ledger.accounts` = `3`, `SELECT count(*) FROM payments._prisma_migrations WHERE finished_at IS NOT NULL` = `1` (same for `tickets` and `ledger`); prints `DB OK` on success, otherwise the failing check and exits 1.

- [ ] **Step 1: Write the Dockerfile, `.dockerignore` (`node_modules`, `**/node_modules`, `.git`, `.turbo`, `infra/.env`, `**/.env`), compose services and verify script**

- [ ] **Step 2: Run the verify script**

  Run: `infra/scripts/verify-db.sh`
  Expected: three images build; each migrate container prints `All migrations have been successfully applied` on the first run and `No pending migrations to apply` on the second; script ends with `DB OK`.

- [ ] **Step 3: Clean up**

  Run: `docker compose -f infra/docker-compose.yml down -v`
  Expected: containers, network and `pgdata` volume removed.

- [ ] **Step 4: Update `AGENTS.md` Commands section**

  Replace the section body with:
  ```markdown
  - Node 26 (`nvm use`), then `corepack enable` and `pnpm install`
  - Lint: `pnpm lint` | Format: `pnpm format:check` | Build: `pnpm build`
  - Unit tests: `pnpm test` | DB integration tests (Docker running): `pnpm test:int`
  - Contracts: `pnpm --filter @eticket/contracts lint` | regenerate types: `pnpm --filter @eticket/contracts generate`
  - Local env: `cp infra/.env.example infra/.env` and set passwords
  - Stack: `docker compose -f infra/docker-compose.yml up -d --build`
  - Verify DB + migrations: `infra/scripts/verify-db.sh` | Reset DB: `docker compose -f infra/docker-compose.yml down -v`
  - Migrations are hand-written SQL (ADR-0015). Never run `prisma migrate dev`.
  - .NET: `dotnet build`, `dotnet test`, `dotnet format --verify-no-changes`
  - Before saying a phase is done: lint, build, test and test:int must pass.
  ```

- [ ] **Step 5: Phase gate — run everything from a clean state**

  Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check`
  Expected: all exit 0; `test:int` reports 5 + 10 + 9 + 10 = 34 passing tests.

- [ ] **Step 6: Commit**

  ```bash
  git add infra/migrate infra/scripts infra/docker-compose.yml .dockerignore AGENTS.md
  git commit -m "feat(infra): run migrations in compose and document phase 1 commands"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-13-phase-1-scaffold-db.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task; a reviewer checks it before the next starts. Costs Claude tokens per task and per review.

**B — OpenCode hand-off (saves Claude tokens).** From the repo root:

```bash
git switch phase-0-spec && git switch -c phase-1-scaffold
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-13-phase-1-scaffold-db.md. \
Execute the plan's tasks 1 to 7 in order. For each task follow every step exactly, run every \
Run command and compare with Expected, and make the commit given in the task. Do not edit \
docs/spec.md except where Task 4 says so, and do not edit packages/contracts/openapi. Never run \
'prisma migrate dev'. Never create or print infra/.env contents outside the steps that copy \
.env.example. If a verification fails twice, stop and report the task, the command and its output."
```

Add `-m <provider/model>` to choose the OpenCode model. `opencode.json` already loads the spec and ADRs as instructions.

**After either option**, back in Claude Code (Opus): run superpowers:requesting-code-review on the `phase-1-scaffold` branch and the EGM drift check against `docs/spec.md` §3 and §9, then the phase summary.
