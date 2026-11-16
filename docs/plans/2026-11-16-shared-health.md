# Shared Health, Graceful Shutdown and Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the SonarCloud duplication hotspots (three identical `health.controller.ts`, three near-identical `main.ts`, four near-identical contract `health.contract.ts`) by moving health, shutdown drain and bootstrap into `@eticket/nest-common` and one contract helper, and add graceful shutdown (readiness fails first, then a drain wait) to every NestJS service.

**Architecture:** `@eticket/nest-common` gains a `HealthModule.forRoot({ checks, timeoutMs, drainMs })` built on `@nestjs/terminus` (so response bodies keep the contract shape `{status, info, error, details}`). Each app supplies small `ReadinessCheck` classes: the three database services one Prisma check, the gateway three downstream-liveness checks. A `ShutdownState` provider fails readiness in `beforeApplicationShutdown` and waits `drainMs` before Nest closes the HTTP server. Bootstrap helpers (`resolveContractFile`, `bootstrapService`) replace the copied parts of each `main.ts`; `createApp` stays per app (test seam).

**Tech Stack:** NestJS 11, `@nestjs/terminus` 11.1.1 (already used by all four apps), Jest, Supertest, Testcontainers.

**Spec:** `docs/spec.md` (§7.1 env vars, §8 testing; health endpoints in §2.2/§6), OpenAPI `packages/contracts/openapi/common.yaml#/components/schemas/Health`, skill `nest-ddd-architecture` §11 (liveness process-only, readiness own hard dependencies, §11.7 shutdown order).

**Branch:** `refactor/shared-health` from `dev`.

## Decisions taken with the user (2026-11-16)

1. Scope: health controllers, `main.ts`, contract health helpers only. `app.module.ts`, `config/env.ts` and the polling jobs keep their duplication for now.
2. Graceful shutdown per skill §11.7: readiness 503 on shutdown, then a drain wait, then Nest's normal close.
3. Gateway readiness keeps checking the three downstream services' `/health/live` (contract suites and `assertGateway` rely on `details` naming them). This deviates from the skill rule "readiness never depends on a downstream service"; record it in ADR-0030 with the reason (single-replica BFF: without its services the gateway can serve nothing).

## Global Constraints

- HTTP behaviour unchanged except the new shutdown 503: `GET /health/live` → 200 `{"status":"ok"}`, never touches a dependency; `GET /health/ready` → 200 `{"status":"ok", …}` or 503 `{"status":"error", …}` (Terminus bodies; must validate against `common.yaml` `Health`). Gateway `details` keeps the keys `ticket-service`, `payment-service`, `ledger-service`; database services keep `database`.
- Per-check timeout 2000 ms (today's `DB_TIMEOUT_MS` / `PROBE_TIMEOUT_MS`); a hung check reports down, never hangs the probe.
- New env var `SHUTDOWN_DRAIN_MS` (integer 0–30000, default 5000) in every Nest app's env class and `.env.example`; tests set `0`. Never in contract tests.
- Shutdown 503 body: `{"status":"error", …}` with an indicator named `shutdown` (`down`, `{ reason: 'shutting_down' }`).
- `@nestjs/terminus` becomes a peer dependency of `@eticket/nest-common` at the exact version the apps use (11.1.1). No other new dependency.
- `createApp(env, opts)` stays in each app's `main.ts` (tests use it); `bootstrap()` behaviour unchanged (`enableShutdownHooks`, listen `0.0.0.0:PORT`).
- K8s/compose grace periods must exceed drain + in-flight: Nest pods use the default 30 s; compose default 10 s stop timeout must be ≥ 5 s drain + job drain — verify, raise `stop_grace_period` if needed.
- Tests first. Commits conventional, ending with the session's `Co-Authored-By` line.
- Never read or print `infra/.env` or `infra/k8s/.env`; never run `smoke.sh` without asking (it destroys the local volume).

## Review Focus

1. **Contract drift in health bodies.** A hand-rolled body instead of Terminus' shape would break `assertResponse('healthReady')` and `assertGateway`. Expect: existing `health.int-spec.ts` and `contract.int-spec.ts` in every app pass unchanged.
2. **Readiness that hangs.** A check whose promise never settles must report down within the timeout. Expect: a nest-common unit test with a never-resolving check returns 503 in under 3 s.
3. **Shutdown order.** Draining after the server closed would drop requests; flipping readiness after closing makes the flip pointless. Expect: a test that calls `app.close()` and, during the drain, observes `/health/ready` 503 while `/health/live` stays 200.
4. **Tests slowed by the drain.** `drainMs` default 5000 would add 5 s to every test teardown. Expect: test helpers set `SHUTDOWN_DRAIN_MS=0`; suite durations unchanged.
5. **Gateway regression.** The gateway's downstream checks move into the shared module; `assertGateway` (infra scripts) and the gateway contract suite still pass.

---

### Task 0: `render-prod.mjs` takes no paths from the command line (SonarCloud jssecurity:S8707)

SonarCloud still reports S8707 on `dev` (`infra/k8s/scripts/render-prod.mjs:55, 84, 119, 120`): any output path derived
from `process.argv` counts as tainted, whatever checks follow. Decision (user, 2026-11-16): remove CLI-supplied paths
entirely.

**Files:**
- Modify: `infra/k8s/scripts/render-prod.mjs`, `render-prod.test.mjs`
- Modify callers: `infra/k8s/scripts/deploy.sh`, `k3d-e2e.sh`, `validate.sh`, `infra/k8s/README.md`, `docs/deployment-gcp.md`
- Modify: `.gitignore` only if a new fixed directory needs it

**Interfaces (Produces):**
- CLI: `render-prod.mjs --target <prod|k3d|validate> --host <dns> --tag <sha-xxxxxxx>` writes the overlay to a fixed directory chosen by a `switch` over the literal target names: `prod` → `infra/k8s/overlays/prod`, `k3d` → `infra/k8s/.rendered/k3d`, `validate` → `infra/k8s/.rendered/validate`. Unknown target → exit 2.
- CLI: `render-prod.mjs --traefik --acme-email <addr>` writes the HelmChartConfig to the fixed file `infra/k8s/.rendered/traefik-config.yaml` and prints that path.
- No argument value is ever concatenated into, joined with, or used to look up a file path. Keep the symlink/`wx` write protections for the fixed paths.
- Pure functions `renderProd({host, tag})` and `renderHelmChartConfig({acmeEmail})` unchanged.

- [ ] **Step 1: Write the failing tests:** each target writes to its fixed directory; an unknown target exits 2 and writes nothing; `--traefik` writes the fixed file and prints its path; `--out` / `--traefik-out` are rejected as unknown options.
- [ ] **Step 2: Run** `node --test infra/k8s/scripts/` → new tests FAIL.
- [ ] **Step 3: Implement**; update every caller (grep for `render-prod.mjs`). The guide's Traefik step becomes `node infra/k8s/scripts/render-prod.mjs --traefik --acme-email "$EMAIL"` followed by `sudo cp infra/k8s/.rendered/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml`.
- [ ] **Step 4: Run** `node --test infra/k8s/scripts/`, `infra/k8s/scripts/validate.sh`, `bash -n` on changed scripts, `deploy.sh sha-abc1234 --dry-run` with a fake `K8S_ENV_FILE` (ends `DEPLOY DRY-RUN`), `pnpm lint`, `pnpm format:check` → all pass.
- [ ] **Step 5: Commit** `fix(k8s): render-prod writes only to fixed paths (no CLI-supplied paths)`.

### Task 1: Shared health module and shutdown state in `@eticket/nest-common`

**Files:**
- Create: `packages/nest-common/src/health/readiness-check.ts`, `health.module.ts`, `health.controller.ts`, `shutdown-state.ts`, `prisma-readiness.ts`, `index.ts`
- Create: `packages/nest-common/src/health/health.module.spec.ts`
- Modify: `packages/nest-common/src/index.ts` (export `./health`), `packages/nest-common/package.json` (peer `@nestjs/terminus` 11.1.1; devDependency for tests), `packages/nest-common/AGENTS.md` (export list)

**Interfaces (Produces):**
- `interface ReadinessCheck { readonly name: string; check(): Promise<void> }` — resolve = up, reject = down.
- `HealthModule.forRoot(opts: { checks: Type<ReadinessCheck>[]; timeoutMs?: number /* 2000 */; drainMs?: number /* 5000 */ }): DynamicModule` — registers `TerminusModule`, the controller at `/health` (`@Public()` and `@SkipThrottle()` so it works in both guard setups), `ShutdownState`, the check classes.
- `ShutdownState implements BeforeApplicationShutdown` with `readonly draining: boolean`.
- `PrismaReadinessCheck` factory: `prismaReadinessCheck(token: Type<{ $queryRawUnsafe(sql: string): Promise<unknown> }>): Type<ReadinessCheck>` named `database`, runs `SELECT 1`.

- [ ] **Step 1: Write the failing tests** in `health.module.spec.ts` (Nest testing module + Supertest, no database): live 200 `{status:'ok'}` with a failing check registered; ready 200 with `details.<name>.status === 'up'` when all checks resolve; 503 `status:'error'` naming the failing check when one rejects; a never-resolving check → 503 within `timeoutMs + 500` ms; after `app.close()` starts with `drainMs: 300`, a request during the drain gets ready 503 with `details.shutdown.status === 'down'` and live 200, and `close()` takes ≥ 300 ms.
- [ ] **Step 2: Run** `pnpm --filter @eticket/nest-common test` → FAIL (module missing).
- [ ] **Step 3: Implement** with Terminus `HealthCheckService` + `HealthIndicatorService`; per-check timeout via `Promise.race`, timer cleared; the shutdown indicator added first when draining.
- [ ] **Step 4: Run** → PASS; `pnpm --filter @eticket/nest-common build` and `lint` → 0.
- [ ] **Step 5: Commit** `feat(nest-common): shared health module with graceful shutdown drain`.

### Task 2: Adopt the shared module in the four Nest apps; shared bootstrap helpers

**Files:**
- Create: `packages/nest-common/src/bootstrap.ts` (+ `bootstrap.spec.ts`): `resolveContractFile(distDir: string, service: 'ticket-service'|'payment-service'|'ledger-service'|'gateway'): string` (built `openapi.json` next to dist, else `require.resolve('@eticket/contracts/openapi/<service>.json')`); `bootstrapService(createApp: (env) => Promise<INestApplication>): Promise<void>` (enableShutdownHooks, PORT from ConfigService, listen `0.0.0.0`) and `runIfMain(module: NodeModule, fn)` if it removes the copied `require.main` block.
- Modify: `apps/{ticket,payment,ledger}-service/src/app.module.ts` (import `HealthModule.forRoot({ checks: [prismaReadinessCheck(PrismaService)], drainMs: env.SHUTDOWN_DRAIN_MS })`, drop `TerminusModule` + local controller), delete `apps/{ticket,payment,ledger}-service/src/health/health.controller.ts`
- Modify: `apps/gateway/src/app.module.ts` + create `apps/gateway/src/health/downstream-live.check.ts` (three `ReadinessCheck` classes or one factory producing them, names `ticket-service`/`payment-service`/`ledger-service`, same HTTP call as today), delete the gateway `health.controller.ts`
- Modify: all four `src/main.ts` to use the helpers; all four `src/config/env.ts` + `.env.example` (`SHUTDOWN_DRAIN_MS`); test support helpers (`test/support/*`) set `SHUTDOWN_DRAIN_MS: '0'`
- Modify: `infra/docker-compose.yml` only if the stop timeout must rise (Global Constraints)

- [ ] **Step 1:** Unit test for `resolveContractFile` (built file preferred, contracts fallback) → FAIL → implement → PASS.
- [ ] **Step 2:** Swap each app; existing `test/health.int-spec.ts` and `test/contract.int-spec.ts` are the regression tests — run per app `pnpm --filter @eticket/<app> test` and `test:int` → PASS unchanged.
- [ ] **Step 3:** Gateway: `pnpm --filter @eticket/gateway test:int` → PASS (health, contract, rate-limit suites).
- [ ] **Step 4: Commit** `refactor: services use the shared health module and bootstrap helpers`.

### Task 3: One contract health helper

**Files:**
- Create: `packages/contract-tests/src/health.ts` exporting `registerHealthContract(getBaseUrl: () => string, validator: ContractValidator): void` (the two existing assertions)
- Modify: the four `src/<suite>/health.contract.ts` to call it (or delete them and call it from each `suite.ts`, whichever leaves less code)

- [ ] **Step 1:** `pnpm --filter @eticket/contract-tests build` and `lint` → 0.
- [ ] **Step 2:** Run all four suites against the local stack via `infra/scripts/contract.sh` (ticket → payment → ledger → gateway) after `docker compose -f infra/docker-compose.yml up -d --build --wait` → all pass.
- [ ] **Step 3: Commit** `test(contract): one shared health contract helper`.

### Task 4: ADR, docs, gate

**Files:**
- Create: `docs/adr/0030-shared-health-and-graceful-shutdown.md` (decision, Terminus kept for the contract shape, drain default and how it relates to K8s/compose grace periods, the gateway readiness deviation and why)
- Modify: `docs/spec.md` §7.1 (`SHUTDOWN_DRAIN_MS`) and §13 (ADR-0030 row); `packages/nest-common/AGENTS.md`; root `AGENTS.md` only if a rule changed

- [ ] **Step 1:** Gate: `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test`, `pnpm test:int`, `pnpm --filter @eticket/contracts check:generated` → all 0.
- [ ] **Step 2:** Runtime: `docker compose … up -d --build --wait`, the four contract suites, then `docker compose -f infra/docker-compose.yml stop gateway` and confirm in its logs the drain message before exit.
- [ ] **Step 3: Commit** `docs: ADR-0030 shared health and graceful shutdown`.

## Execution options

**A — Claude Code subagents (Sonnet 5.5):** superpowers:subagent-driven-development, one implementer and one reviewer per task, final whole-branch review. Task 1 and 2 reviewers check Review Focus 1–5.

**B — OpenCode hand-off:**

```bash
opencode run "Read AGENTS.md, packages/nest-common/AGENTS.md and docs/plans/2026-11-16-shared-health.md. You are on branch \
refactor/shared-health; do not switch branches. Execute tasks 1 to 4 in order, tests first, run every verification and \
commit as each task says. Never read or print infra/.env or infra/k8s/.env. Never run infra/scripts/smoke.sh. Add no \
dependency except the @nestjs/terminus peer dependency in nest-common. Never stop or prune Docker resources of other \
projects. If a verification fails twice, stop and report."
```
