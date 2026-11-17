# Remove the NestJS Ticket Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ASP.NET Core service (`apps/ticket-service-dotnet`) becomes the only Ticket Service in `dev` and `main`; the NestJS one (`apps/ticket-service`) is deleted, with no change to the deployed system's behaviour or database.

**Architecture:** The NestJS app is already out of the deploy path (compose `reference` profile only), except that it owns the `tickets` SQL migrations and the schema invariant tests. Move the migrations byte-for-byte into the .NET app folder (the `migrate-tickets` image keeps running `prisma migrate deploy`, so prod's `_prisma_migrations` checksums still match), port the schema tests to xUnit, then delete the app and every reference. ADR-0002 and ADR-0021 stay as history, marked superseded by a new ADR-0031.

**Tech Stack:** ASP.NET Core 10 + xUnit + Testcontainers + Npgsql, Prisma 7.10.1 CLI (migrate image only), pnpm/Turborepo, Docker Compose, Kustomize/K3s, GitHub Actions.

**Spec:** `docs/spec.md` (sections 2.1, 3, 13), `docs/challenge.md` section 3 ("Ticket Service Backend (C# .NET)").

**Archive:** the full pre-removal tree is on branch `archive/ticket-service-nestjs` (pushed, = `origin/main` at 7ec33f6). Do not delete it.

## Global Constraints

- Every `migration.sql` under the moved folder must be byte-identical to the original (sha256 compared). Never edit an applied migration (ADR-0015).
- Migration directory names stay identical (`20261113000000_init`, …); `migration_lock.toml` stays.
- Image names in `.github/images.json` do not change (`ticket-service`, `migrate-tickets`); k8s manifests do not change.
- No new dependency. Never run `prisma migrate dev`. Never read or print `.env`.
- Work on branch `chore/remove-nestjs-ticket-service` from `dev`; PR to `dev`, then release PR `dev` → `main`. Use `/usr/bin/git` for `--no-ff` merges (rtk fast-forwards).
- Done = `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test`, `pnpm test:int` green, plus compose smoke, the four contract suites, and `infra/k8s/scripts/k3d-e2e.sh`.

## Review Focus

1. **Prod re-applying or rejecting migrations.** After the move, the migrate initContainer on the live DB must log `No pending migrations` (k3d-e2e.sh already asserts this on redeploy; Task 2 also checks it against an already-migrated compose volume).
2. **`prisma migrate deploy` with a model-less `schema.prisma`.** Task 2 shrinks the schema to a datasource; verify it on an empty DB and on a migrated DB.
3. **Lost schema coverage.** CHECK constraints, grants, the seed and the oversell race were only tested in the NestJS app. Task 1 ports every case before anything is deleted.
4. **Lockfile/Docker drift.** Removing a workspace package changes `pnpm-lock.yaml`; every Dockerfile runs `pnpm install --frozen-lockfile`, so all three Node images (`nest-service`, `web`, `dotnet-ticket` contract stage) must build.
5. **CI hard checks on removed paths.** `ci.yml` fails if a listed coverage file is missing; `sonar-project.properties` lists lcov paths; `.github/filters.yml` decides which images rebuild on `main`.

---

### Task 1: Port the tickets schema invariant tests to .NET

**Files:**
- Create: `apps/ticket-service-dotnet/tests/TicketService.Tests/Integration/SchemaConstraintsTests.cs`
- Reference (read, do not change): `apps/ticket-service/test/schema.int-spec.ts`, `apps/ticket-service-dotnet/tests/TicketService.Tests/Support/PostgresFixture.cs`, `Integration/ReservationRaceTests.cs` (collection/fixture pattern)

**Interfaces:**
- Consumes: `PostgresFixture.OpenAsync(string role)`, `ExclusivePostgresCollection` (whole-DB tests).
- Produces: nothing used by later tasks.

- [ ] **Step 1:** Write `SchemaConstraintsTests` with `[Trait("Category", "Integration")]` in `ExclusivePostgresCollection`, one `[Fact]` per case in `schema.int-spec.ts`, same SQL and assertions:
  - `SeedsTheThreeTicketTypes`: GOLD/Gold/10000, PREMIUM/Premium/20000, VIP/VIP/50000 (copy exact names from the TS file), currency `AED`, quota 100, sold 0, reserved 0, ordered by price.
  - `RejectsSoldPlusReservedAboveQuota`: `PostgresException.SqlState == "23514"`.
  - `ConditionalReservationStopsAtQuotaEdge`: same `RESERVE_SQL`; reserving to exactly 100 returns a row, one more returns none.
  - `NeverOversellsUnder20ConcurrentReservationsOf10`: 20 parallel connections as `tickets_app`; exactly 10 succeed; `sold + reserved == 100`.
  - `TiesConfirmedToConfirmedAtAndPaidTransactionId`, `RejectsUnknownOrderStatus`, `KeepsPaidTransactionIdUnique` (`23505`), `ValidatesOrderItems`, `BlocksDeletingTicketTypeWithOrderItems` (`23503`), `DeniesTicketsAppAccessToPaymentsSchema` (`42501`).
  - Reset state between facts the way `ReservationRaceTests` does (it shares one DB).
- [ ] **Step 2:** Run `pnpm --filter @eticket/ticket-service-dotnet test:int`. Expected: PASS (this characterizes existing migrations, so green on the first run is correct). Then break one assertion on purpose (e.g. expect 11 successes), confirm it FAILS, and revert.
- [ ] **Step 3:** Run `pnpm --filter @eticket/ticket-service-dotnet lint`. Expected: no changes.
- [ ] **Step 4:** Commit `test(ticket-dotnet): port tickets schema invariant tests from the NestJS app`.

### Task 2: Move the tickets migrations into the .NET app

**Files:**
- Move (`git mv`): `apps/ticket-service/prisma/` → `apps/ticket-service-dotnet/prisma/`; `apps/ticket-service/prisma.config.ts` → `apps/ticket-service-dotnet/prisma.config.ts`
- Modify: `apps/ticket-service-dotnet/prisma/schema.prisma` (datasource only)
- Modify: `apps/ticket-service-dotnet/tests/TicketService.Tests/Support/PostgresFixture.cs:38`
- Modify: `infra/docker-compose.yml` (`migrate-tickets` build arg `SERVICE`)
- Modify: `.github/images.json` (`migrate-tickets` `buildArgs.SERVICE`)
- Modify: `.github/filters.yml:56-57` (`migrate-tickets` paths)

**Interfaces:**
- Produces: tickets migrations live at `apps/ticket-service-dotnet/prisma/migrations/`; `infra/migrate/Dockerfile` is built with `SERVICE=ticket-service-dotnet` (the Dockerfile itself is unchanged: it copies `apps/${SERVICE}/prisma` and `prisma.config.ts`).

- [ ] **Step 1:** Record `sha256sum apps/ticket-service/prisma/migrations/*/migration.sql` to the scratchpad, then `git mv` both paths.
- [ ] **Step 2:** Replace `schema.prisma` with a comment saying it exists only so `prisma migrate deploy` can run (the runtime model is the EF Core mapping, guarded by `SchemaMappingTests`) plus `datasource db { provider = "postgresql" }`. No generator, no models.
- [ ] **Step 3:** Point `PostgresFixture` at `apps/ticket-service-dotnet/prisma/migrations`; set `SERVICE: ticket-service-dotnet` in compose `migrate-tickets` and in `images.json`; change the filters to `apps/ticket-service-dotnet/prisma/**` and `apps/ticket-service-dotnet/prisma.config.ts`.
- [ ] **Step 4:** Re-run sha256 on the new paths; diff against Step 1. Expected: identical.
- [ ] **Step 5:** Run `pnpm --filter @eticket/ticket-service-dotnet test:int`. Expected: PASS (includes Task 1's tests and `SchemaMappingTests`).
- [ ] **Step 6:** On an already-migrated volume: `docker compose -f infra/docker-compose.yml up -d --build --wait` from `dev` first (before Step 1) if no volume exists, then on this branch `docker compose -f infra/docker-compose.yml up --build --no-deps migrate-tickets`. Expected log: `No pending migrations to apply.`, exit 0.
- [ ] **Step 7:** On a fresh DB: `infra/scripts/smoke.sh` (it runs `down -v`). Expected: ends with `SMOKE OK`. Then `infra/scripts/verify-db.sh` against an up stack: passes.
- [ ] **Step 8:** Run `node --test infra/k8s/scripts/` (the ghcr test reads `images.json`). Expected: PASS.
- [ ] **Step 9:** Commit `refactor(tickets): move the tickets SQL migrations into the .NET app`.

### Task 3: Delete the NestJS app and every build reference

**Files:**
- Delete: `apps/ticket-service/` (whole directory)
- Modify: `infra/docker-compose.yml` (remove the `ticket-service-node` service and its comment)
- Modify: `infra/docker/nest-service.Dockerfile:13`, `infra/docker/web.Dockerfile:11`, `infra/docker/dotnet-ticket.Dockerfile:12` (drop the `apps/ticket-service/package.json` COPY; update the nest-service header example to `SERVICE=payment-service --build-arg PORT=3002`)
- Modify: `.github/workflows/ci.yml:51,89` (drop the `apps/ticket-service/coverage/...` entries from the required-coverage lists)
- Modify: `sonar-project.properties:16` (drop both `apps/ticket-service/coverage/...` lcov paths)
- Modify: `pnpm-lock.yaml` (via `pnpm install`, never by hand)

- [ ] **Step 1:** `git rm -r apps/ticket-service` and make the edits above.
- [ ] **Step 2:** `pnpm install`, then `pnpm install --frozen-lockfile`. Expected: second command succeeds with no lockfile change.
- [ ] **Step 3:** `/usr/bin/git grep -n -E "apps/ticket-service([^-]|$)|@eticket/ticket-service([^-]|$)|ticket-service-node" -- ':!docs' ':!.superpowers' ':!AGENTS.md' ':!**/AGENTS.md' ':!.claude' ':!packages/contract-tests/README.md'`. Expected: no output (docs are Task 4).
- [ ] **Step 4:** `pnpm lint && pnpm build && pnpm test`. Expected: all green.
- [ ] **Step 5:** `docker compose -f infra/docker-compose.yml build`. Expected: every image builds (frozen lockfile in each Dockerfile).
- [ ] **Step 6:** Commit `chore: remove the NestJS reference Ticket Service`.

### Task 4: Docs, ADR-0031 and agent instructions

**Files:**
- Create: `docs/adr/0031-remove-nestjs-ticket-service.md`
- Modify: `docs/adr/0002-nestjs-first-dotnet-port.md`, `docs/adr/0021-ticket-service-dotnet-port.md` (status line only: `Superseded in part by [ADR-0031](./0031-remove-nestjs-ticket-service.md)`; body unchanged)
- Modify: `README.md:45` (Ticket Service row: `ASP.NET Core, apps/ticket-service-dotnet`), `README.md:93` (drop the `apps/ticket-service` env link; the .NET service reads compose env, so point at `infra/.env.example`), `README.md:189` (language split: Ticket Service is C#/.NET as the challenge requires; contract-first OpenAPI and the black-box contract suite pin its behaviour; link ADR-0021 and ADR-0031)
- Modify: `docs/spec.md` section 2.1 (Ticket Service row `ASP.NET Core`; replace the Phase 5 note and the language note with: .NET Ticket Service is the only implementation, ADR-0021/0031; Payment Node matches the suggestion; Ledger NestJS vs "Python or similar" per ADR-0002), section 13 index (mark 0002 and 0021 rows "superseded in part by 0031"; add the 0031 row)
- Modify: `docs/local-demo.md:7` (drop the two sentences about the reference profile)
- Modify: `packages/contracts/openapi/ticket-service.yaml:8` (description: implemented by the ASP.NET Core Ticket Service); then `pnpm --filter @eticket/contracts generate` and commit any regenerated output
- Modify: `packages/contract-tests/README.md` (remove the in-process NestJS run and the `:3011` lines; the ticket suite runs against compose via `infra/scripts/contract.sh ticket`)
- Modify: `AGENTS.md` (stack line 41: `apps/ticket-service-dotnet`: ASP.NET Core Ticket Service; delete command lines 111 and 121; line 122 example without the `:3011` reference; .NET test lines stay)
- Modify: `infra/AGENTS.md:18` (drop `ticket-service-node 3011`), `packages/nest-common/AGENTS.md:3` (drop `apps/ticket-service`), `apps/ticket-service-dotnet/AGENTS.md` (not "port"; schema owned by the SQL migrations in `prisma/migrations` of this app; parity bullets reworded as behaviour pinned by the contract suite; keep the rule content)
- Modify: `.claude/skills/contract-change/SKILL.md:27,38-39` (Ticket changes: .NET only), `.claude/skills/sql-migration/SKILL.md` (`tickets` → `apps/ticket-service-dotnet`; schema tests in `SchemaConstraintsTests.cs`; no `schema.prisma` sync or `generate` for tickets, update the EF mapping and `SchemaMappingTests` instead)
- Modify: `docs/engineering/project-inventory.md:21,40` (remove the NestJS row; the .NET row owns the migrations; drop the reference profile)

ADR-0031 content (context, decision, alternatives, trade-off), short:
- Context: the challenge names the Ticket Service as the C#/.NET service; since Phase 5 the deployed one is .NET; the NestJS version only ran under a compose profile and still held the tickets migrations and schema tests, which made reviewers ask which one is real.
- Decision: delete `apps/ticket-service`; move the migrations unchanged into `apps/ticket-service-dotnet/prisma` (still applied by `prisma migrate deploy` in `migrate-tickets`); port the schema tests to xUnit; keep the code on branch `archive/ticket-service-nestjs`.
- Alternatives: keep it as a reference (rejected: two implementations to keep in step, confusing); switch migrations to EF Core or DbUp (rejected: new tool, re-baselining prod's history).
- Trade-off: no second implementation to diff against; the contract suite against the .NET service is the behaviour gate.

Leave unchanged (dated history): `docs/plans/*`, `.superpowers/*`, `docs/adr/0016*`, `docs/adr/0024*`, `docs/engineering/initial-assessment.md`, `docs/engineering/instruction-system-validation.md`, phase reports.

- [ ] **Step 1:** Make the edits and write ADR-0031.
- [ ] **Step 2:** `/usr/bin/git grep -n -i -E "apps/ticket-service([^-]|$)|ticket-service-node|NestJS reference|reference profile|:3011|3011" -- ':!docs/plans' ':!.superpowers' ':!docs/adr' ':!docs/engineering/initial-assessment.md' ':!docs/engineering/instruction-system-validation.md'`. Expected: no output.
- [ ] **Step 3:** `pnpm format:check && pnpm --filter @eticket/contracts lint`. Expected: green.
- [ ] **Step 4:** Commit `docs: Ticket Service is .NET only (ADR-0031)`.

### Task 5: Full gate, PRs and deployment

- [ ] **Step 1:** Run the `phase-gate` skill: `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test`, `pnpm test:int`, `infra/scripts/smoke.sh`, then with the stack up `infra/scripts/contract.sh ticket|payment|ledger|gateway` in that order, then `infra/k8s/scripts/k3d-e2e.sh` (asserts `No pending migrations` on redeploy). All must pass; paste failing output if not.
- [ ] **Step 2:** Run the `repo-review` skill on the branch diff; fix findings.
- [ ] **Step 3:** Push, open a PR to `dev`, wait for CI (`verify`, `test`, `test-int`, `e2e`, `k3d`, `sonar`) green, merge.
- [ ] **Step 4:** Open the release PR `dev` → `main`, CI green, merge. `images.yml` rebuilds `migrate-tickets` (filter hit) and re-tags the rest; `deploy.yml` deploys.
- [ ] **Step 5:** Verify the live demo: `deploy.yml` run green; `curl -s -o /dev/null -w '%{http_code}' https://eticket-zain.duckdns.org/api/health/ready` = `200`; on the VM `kubectl logs deploy/ticket-service -n eticketing -c migrate` shows `No pending migrations`; one card purchase through the shop appears in the backoffice ledger.
- [ ] **Step 6:** Run the EGM drift check against `docs/spec.md`.

## Execution options

**(A) Claude subagents on Sonnet (recommended).** Use superpowers:subagent-driven-development: one implementer per task, a reviewer after each, tasks strictly in order (1 → 5). Task 5 Steps 3-5 (push, merge, deploy check) run in the main session.

**(B) OpenCode hand-off.** Tasks 1-4 are self-contained; Claude then reviews, runs Task 5 and the drift check.

```bash
opencode run "Execute docs/plans/2026-11-17-remove-nestjs-ticket-service.md Tasks 1-4 in order on branch chore/remove-nestjs-ticket-service (create it from dev). Read AGENTS.md and the AGENTS.md of every area you touch first. Follow each step, run every verification command and stop on the first failure with its output. Commit after each task with the given message. Do not push, do not merge, do not touch Task 5."
```
