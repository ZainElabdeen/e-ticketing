# E-Ticketing & Payment Simulation Platform — Agent Rules

This file is the single source of repo-wide rules for every AI coding tool
(Claude Code, OpenCode, Codex, Cursor, Copilot). Keep it short and current.

## Instruction map (ADR-0024)

- **Area rules**: each app and package with local conventions has its own
  `AGENTS.md` (`apps/*`, `packages/nest-common`, `packages/contracts`, `infra`).
  Read it before editing files there. All three NestJS apps also follow
  `packages/nest-common/AGENTS.md` (their `CLAUDE.md` imports both).
- **Workflows** live in `.claude/skills/` (Claude Code and OpenCode load them):
  `contract-change`, `sql-migration`, `add-payment-method`, `phase-gate`,
  `ui-walkthrough`, `web-review`, `repo-review`, `project-audit`. Other agents:
  open the `SKILL.md` that matches the task.
- **Upkeep**: `docs/engineering/maintenance-guide.md`.

Source of truth for requirements: `docs/challenge.md`.
Design decisions: `docs/spec.md` and `docs/adr/`.
Run it locally (setup, login, seed data, test cards, demo script): `docs/local-demo.md`.

## How to work

- Work in phases (see `docs/PROMPT.md`). STOP after each phase for review.
- Record every non-obvious decision as a short ADR in `docs/adr/NNNN-title.md`
  (context, decision, alternatives, trade-off).
- Tests first for payment logic, idempotency, quota reservation and ledger posting.
- Small conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Branch flow: phase or feature branch → PR to `dev` → release PR `dev` → `main`.
  `main` is production and the GitHub default branch; only `main` publishes images (ADR-0025).
- Never commit secrets. Only `.env.example` files. Never read or print `.env`.
- Check current library docs before using an API you are not sure about.
- Do not add a dependency, service or pattern that is not listed here without
  writing an ADR and asking first.

## Stack

- Monorepo: pnpm workspaces + Turborepo.
- `apps/web`: React + Vite + TypeScript SPA (shop, checkout, backoffice).
- `apps/gateway`: NestJS BFF. Public edge, rate limit, backoffice JWT login.
- `apps/ticket-service-dotnet`: ASP.NET Core Ticket Service (OpenAPI contract in `packages/contracts`).
- `apps/payment-service`: NestJS.
- `apps/ledger-service`: NestJS.
- `packages/contracts`: OpenAPI specs + generated TS types.
- `packages/config`: shared eslint + tsconfig.
- `infra/`: docker-compose.yml and k8s manifests (K3s, Traefik ingress; ADR-0026).
- PostgreSQL: one instance, one schema and one DB user per service
  (`tickets`, `payments`, `ledger`). No cross-schema foreign keys.

## Functional rules

- Tickets: Gold 100 AED, Premium 200 AED, VIP 500 AED, quota 100 each,
  seeded by migration.
- `POST /orders`: server calculates the total and reserves quota with one
  atomic conditional UPDATE. Order is PENDING and expires after 15 minutes;
  a scheduled job releases expired reservations.
- `POST /payments` requires an `Idempotency-Key` header. Amount comes from
  the Ticket Service, never from the client.
- Card: Luhn-valid number = immediate success. Never store the card number.
- QR: return PENDING + QR payload; the SERVER marks success after 8 seconds;
  the SPA polls `GET /payments/:id`.
- Every success creates a transaction (transaction ID, payment reference,
  timestamp) and an outbox event in the same DB transaction.
- Outbox worker posts a journal entry to the Ledger and confirms the order
  in the Ticket Service. Both calls idempotent, with retry.
- Ledger: double entry. Debit "Payment Gateway Clearing", credit "Ticket
  Sales Revenue". Debits must equal credits. Append-only.
  `UNIQUE(transaction_id)` on journal entries.
- Backoffice: login, then view transactions, ledger entries and ticket
  availability.

## Patterns and quality

- Payment methods: Strategy + registry (`PaymentHandler` interface,
  `CardHandler`, `QrHandler`). Adding Wallet/Bank Transfer/Crypto = one class.
- Idempotency table: unique key + request hash; same key returns the stored
  response; same key with a different body returns 422.
- Money as integer minor units + currency column.
- Service-to-service auth by API key header. The browser never holds a key.
- Input validation on every endpoint. Swagger on every service.
- DB: foreign keys inside each schema, CHECK constraints
  (`sold + reserved <= quota`, `amount > 0`), indexes on status, created_at,
  order_id, transaction_id.
- Layers per service: controller, application service, domain, repository.
- Health endpoints, structured JSON logs, correlation ID passed between services.

## Packages

- NestJS: @nestjs/swagger, class-validator, Prisma (raw SQL migrations for
  CHECK constraints), @nestjs/config, @nestjs/throttler, helmet, nestjs-pino,
  @nestjs/terminus, @nestjs/schedule, @nestjs/axios + axios (service-to-service
  HTTP, ADR-0019), @nestjs/jwt + bcryptjs (gateway auth, ADR-0022), Jest, Supertest, Testcontainers.
- .NET: ASP.NET Core Web API, EF Core + Npgsql, FluentValidation, Swagger UI,
  Serilog, xUnit, Testcontainers, dotnet format. Test-only (ADR-0025): `coverlet.collector`.
- Web: React Router 8 (`react-router`), TanStack Query, React Hook Form + Zod,
  openapi-typescript + openapi-fetch, CSS Modules (no UI framework),
  qrcode.react, Vitest + Testing Library. No mock data. Companions (ADR-0023):
  @vitejs/plugin-react, @hookform/resolvers, jsdom, @testing-library/user-event,
  @testing-library/jest-dom, @testing-library/dom, eslint-plugin-react-hooks, globals,
  @fontsource-variable/archivo (self-hosted font). Test-only (ADR-0025):
  @vitest/coverage-v8 (pinned to the vitest version); `dotnet-sonarscanner` joins the .NET side in the CI task.

## Commands

- Node 26 (`nvm use`), then `corepack enable` and `pnpm install`
- Prerequisite for the root gate (`pnpm lint|build|test|test:int`): .NET SDK 10.0.404 (see `global.json`), on `PATH` or in `~/.dotnet` (official `dotnet-install.sh`)
- Lint: `pnpm lint` | Format: `pnpm format:check` | Build: `pnpm build`
- Unit tests: `pnpm test` | DB integration tests (Docker running): `pnpm test:int`
- Contracts: `pnpm --filter @eticket/contracts lint` | regenerate types: `pnpm --filter @eticket/contracts generate`
- Payment Service only: `pnpm --filter @eticket/payment-service test` (unit) and `pnpm --filter @eticket/payment-service test:int` (integration)
- Ledger Service only: `pnpm --filter @eticket/ledger-service test` (unit) and `pnpm --filter @eticket/ledger-service test:int` (integration)
- Gateway only: `pnpm --filter @eticket/gateway test` (unit) and `pnpm --filter @eticket/gateway test:int` (integration)
- One-command local setup (after `pnpm install`): `node infra/scripts/setup-local.mjs` generates every secret in `infra/.env` and the backoffice admin login, never overwriting real values. Flags: `--email <addr>`, `--password-stdin`, `--reset-admin`, `--env <path>`, `--no-ports`, `--login-file <path>`. The login is printed once to a TTY; otherwise it goes to `infra/.admin-login.txt` (mode 600, git-ignored). Script tests: `node --test infra/scripts/` (also run by `pnpm test`)
- Admin password hash for the Gateway: `node infra/scripts/admin-hash.mjs` (prompts, prints `ADMIN_PASSWORD_HASH_B64`). After `cp infra/.env.example infra/.env`, generate `ADMIN_EMAIL` and the hash with `--append infra/.env --email <addr>` (prints only key names); `ADMIN_PASSWORD_DEV` must be the same password that was hashed
- Gateway contract suite via compose (suites run in order ticket → payment → ledger → gateway): `infra/scripts/contract.sh gateway`
- .NET Ticket Service unit tests: `pnpm --filter @eticket/ticket-service-dotnet test`
- .NET Ticket Service integration tests (Docker running): `pnpm --filter @eticket/ticket-service-dotnet test:int`
- .NET SDK lives in `~/.dotnet`; `apps/ticket-service-dotnet/scripts/dotnet.sh` sets `DOTNET_ROOT` and `PATH`
- Contract suite via compose keys (no key printed): `infra/scripts/contract.sh <ticket|payment|ledger|gateway> [ticketBaseUrl]`
- Ticket contract suite against a running target: `CONTRACT_BASE_URL=… CONTRACT_API_KEY=… CONTRACT_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract:ticket`
- Payment contract suite against a running target: `CONTRACT_PAYMENT_BASE_URL=… CONTRACT_PAYMENT_API_KEY=… CONTRACT_TICKET_BASE_URL=… CONTRACT_TICKET_API_KEY=… CONTRACT_QR_DELAY_SECONDS=8 pnpm --filter @eticket/contract-tests test:contract:payment` (run the ticket suite first; it drains VIP)
- Ledger contract suite against a running target: `CONTRACT_LEDGER_BASE_URL=… CONTRACT_LEDGER_API_KEY=… CONTRACT_LEDGER_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract:ledger`
- Demo data (stack up): `infra/scripts/seed-demo.sh` buys card and QR tickets through the gateway so the backoffice has data (not idempotent: every run consumes 6 tickets of quota, so repeated runs eventually exhaust VIP (quota 100) and the order fails with a 409 partway through; `--dry-run` prints the plan; ends with `SEED OK`)
- Smoke test (Docker running): `infra/scripts/smoke.sh` (destroys the local compose volume with `down -v`; ends with `SMOKE OK`; `--keep` leaves the stack up)
- Local env: `node infra/scripts/setup-local.mjs` (recommended; generates every secret), or manually `cp infra/.env.example infra/.env` and set passwords. If host port 5432 or 3000 is taken by another project, set `POSTGRES_HOST_PORT` / `GATEWAY_HOST_PORT` in `infra/.env` (both bind to 127.0.0.1; smoke and `contract.sh gateway` follow `GATEWAY_HOST_PORT` and abort if the port is not this Gateway)
- Stack: `docker compose -f infra/docker-compose.yml up -d --build`
- Web in compose (nginx serves the SPA and proxies `/api/` to the gateway): `http://127.0.0.1:${WEB_HOST_PORT:-8080}`; set `WEB_HOST_PORT` in `infra/.env` if 8080 is taken (smoke's web-origin step follows it, or `SMOKE_WEB_URL`)
- Verify DB + migrations: `infra/scripts/verify-db.sh` | Reset DB: `docker compose -f infra/docker-compose.yml down -v`
- Migrations are hand-written SQL (ADR-0015). Never run `prisma migrate dev`.
- Web: `pnpm --filter @eticket/web dev` (Vite, proxies `/api` to the gateway; `cp apps/web/.env.example apps/web/.env` to change the target) | `pnpm --filter @eticket/web test` | `pnpm --filter @eticket/web build`
- .NET: `dotnet build`, `dotnet test`, `dotnet format --verify-no-changes`
- K3s (ADR-0026; guide `infra/k8s/README.md`): `node --test infra/k8s/scripts/` (manifest and script tests, also in `pnpm test`), `infra/k8s/scripts/render.sh <local|prod|dir>`, `infra/k8s/scripts/validate.sh` (kubeconform), `infra/k8s/scripts/k3d-e2e.sh [--keep]` (real K3s in Docker, own cluster, private KUBECONFIG, port 8081, ~10 min), `infra/k8s/scripts/apply-secrets.sh [--dry-run]`, `infra/k8s/scripts/deploy.sh <sha-xxxxxxx> [--dry-run]` (VM or any cluster `kubectl` points at; never run it without `--dry-run` here), `infra/k8s/scripts/install-ci-tools.sh <dir> kubectl|kubeconform|k3d`
- CI (ADR-0025): `.github/workflows/ci.yml` runs `verify`, `test`, `test-int`, `e2e` and `sonar` on PRs and pushes to `dev`/`main`. Coverage is opt-in: `CI_COVERAGE=1 pnpm test` / `pnpm test:int`. SonarCloud needs secret `SONAR_TOKEN`; optional repo variables `SONAR_ORGANIZATION`, `SONAR_PROJECT_KEY`, `SONAR_DOTNET_PROJECT_KEY` (defaults in the workflow). The `sonar` job skips when the secret is absent. Actions are pinned to full commit SHAs with a version comment. NuGet audit gate: `sh apps/ticket-service-dotnet/scripts/nuget-audit.sh`
- Images (ADR-0025): `.github/workflows/images.yml` builds changed images on both arches (path filters in `.github/filters.yml`, list in `.github/images.json`) and pushes to GHCR only from `main`. A failed `main` image run is recovered by dispatching `images.yml` on `main` with `all=true`.
- Phase 9 CI binaries (ADR-0026, not repo dependencies): kubectl, kubeconform and k3d, pinned with sha256 in `install-ci-tools.sh`.
- Before saying a phase is done: lint, build, test and test:int must pass.
