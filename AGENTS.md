# E-Ticketing & Payment Simulation Platform — Agent Rules

This file is the single source of rules for every AI coding tool
(Claude Code, OpenCode, Codex, Cursor, Copilot). Keep it short and current.

Source of truth for requirements: `docs/challenge.md`.
Design decisions: `docs/spec.md` and `docs/adr/`.

## How to work

- Work in phases (see `docs/PROMPT.md`). STOP after each phase for review.
- Record every non-obvious decision as a short ADR in `docs/adr/NNNN-title.md`
  (context, decision, alternatives, trade-off).
- Tests first for payment logic, idempotency, quota reservation and ledger posting.
- Small conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Never commit secrets. Only `.env.example` files. Never read or print `.env`.
- Check current library docs before using an API you are not sure about.
- Do not add a dependency, service or pattern that is not listed here without
  writing an ADR and asking first.

## Stack

- Monorepo: pnpm workspaces + Turborepo.
- `apps/web`: React + Vite + TypeScript SPA (shop, checkout, backoffice).
- `apps/gateway`: NestJS BFF. Public edge, rate limit, backoffice JWT login.
- `apps/ticket-service`: NestJS first. Later ported to ASP.NET Core in
  `apps/ticket-service-dotnet` with the SAME OpenAPI contract.
- `apps/payment-service`: NestJS.
- `apps/ledger-service`: NestJS.
- `packages/contracts`: OpenAPI specs + generated TS types.
- `packages/config`: shared eslint + tsconfig.
- `infra/`: docker-compose.yml and k8s manifests (K3s, Traefik ingress).
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
  Serilog, xUnit, Testcontainers, dotnet format.
- Web: React Router, TanStack Query, React Hook Form + Zod,
  openapi-typescript + openapi-fetch, CSS Modules (no UI framework),
  qrcode.react, Vitest + Testing Library. No mock data.

## Commands

- Node 26 (`nvm use`), then `corepack enable` and `pnpm install`
- Prerequisite for the root gate (`pnpm lint|build|test|test:int`): .NET SDK 10.0.404 (see `global.json`), on `PATH` or in `~/.dotnet` (official `dotnet-install.sh`)
- Lint: `pnpm lint` | Format: `pnpm format:check` | Build: `pnpm build`
- Unit tests: `pnpm test` | DB integration tests (Docker running): `pnpm test:int`
- Contracts: `pnpm --filter @eticket/contracts lint` | regenerate types: `pnpm --filter @eticket/contracts generate`
- Ticket Service only: `pnpm --filter @eticket/ticket-service test` (unit) and `pnpm --filter @eticket/ticket-service test:int` (integration)
- Payment Service only: `pnpm --filter @eticket/payment-service test` (unit) and `pnpm --filter @eticket/payment-service test:int` (integration)
- Ledger Service only: `pnpm --filter @eticket/ledger-service test` (unit) and `pnpm --filter @eticket/ledger-service test:int` (integration)
- Gateway only: `pnpm --filter @eticket/gateway test` (unit) and `pnpm --filter @eticket/gateway test:int` (integration)
- Admin password hash for the Gateway: `node infra/scripts/admin-hash.mjs` (prompts, prints `ADMIN_PASSWORD_HASH_B64`). After `cp infra/.env.example infra/.env`, generate `ADMIN_EMAIL` and the hash with `--append infra/.env --email <addr>` (prints only key names); `ADMIN_PASSWORD_DEV` must be the same password that was hashed
- Gateway contract suite via compose (run last, after ticket, payment, ledger): `infra/scripts/contract.sh gateway`
- .NET Ticket Service unit tests: `pnpm --filter @eticket/ticket-service-dotnet test`
- .NET Ticket Service integration tests (Docker running): `pnpm --filter @eticket/ticket-service-dotnet test:int`
- .NET SDK lives in `~/.dotnet`; `apps/ticket-service-dotnet/scripts/dotnet.sh` sets `DOTNET_ROOT` and `PATH`
- Compose `ticket-service` is the .NET image. Reference NestJS Ticket Service on `127.0.0.1:3011`: `docker compose -f infra/docker-compose.yml --profile reference up -d --build --wait ticket-service-node`
- Contract suite via compose keys (no key printed): `infra/scripts/contract.sh <ticket|payment|ledger|gateway> [ticketBaseUrl]`, e.g. `infra/scripts/contract.sh ticket http://127.0.0.1:3011` for the reference
- Ticket contract suite against a running target: `CONTRACT_BASE_URL=… CONTRACT_API_KEY=… CONTRACT_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract:ticket`
- Payment contract suite against a running target: `CONTRACT_PAYMENT_BASE_URL=… CONTRACT_PAYMENT_API_KEY=… CONTRACT_TICKET_BASE_URL=… CONTRACT_TICKET_API_KEY=… CONTRACT_QR_DELAY_SECONDS=8 pnpm --filter @eticket/contract-tests test:contract:payment` (run the ticket suite first; it drains VIP)
- Ledger contract suite against a running target: `CONTRACT_LEDGER_BASE_URL=… CONTRACT_LEDGER_API_KEY=… CONTRACT_LEDGER_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract:ledger`
- Smoke test (Docker running): `infra/scripts/smoke.sh` (destroys the local compose volume with `down -v`; ends with `SMOKE OK`; `--keep` leaves the stack up)
- Local env: `cp infra/.env.example infra/.env` and set passwords. If host port 5432 or 3000 is taken by another project, set `POSTGRES_HOST_PORT` / `GATEWAY_HOST_PORT` in `infra/.env` (both bind to 127.0.0.1; smoke and `contract.sh gateway` follow `GATEWAY_HOST_PORT` and abort if the port is not this Gateway)
- Stack: `docker compose -f infra/docker-compose.yml up -d --build`
- Verify DB + migrations: `infra/scripts/verify-db.sh` | Reset DB: `docker compose -f infra/docker-compose.yml down -v`
- Migrations are hand-written SQL (ADR-0015). Never run `prisma migrate dev`.
- .NET: `dotnet build`, `dotnet test`, `dotnet format --verify-no-changes`
- Before saying a phase is done: lint, build, test and test:int must pass.
