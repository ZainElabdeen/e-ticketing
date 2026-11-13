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
  @nestjs/terminus, @nestjs/schedule, Jest, Supertest, Testcontainers.
- .NET: ASP.NET Core Web API, EF Core + Npgsql, FluentValidation, Swagger UI,
  Serilog, xUnit, Testcontainers, dotnet format.
- Web: React Router, TanStack Query, React Hook Form + Zod,
  openapi-typescript + openapi-fetch, CSS Modules (no UI framework),
  qrcode.react, Vitest + Testing Library. No mock data.

## Commands

- Node 26 (`nvm use`), then `corepack enable` and `pnpm install`
- Lint: `pnpm lint` | Format: `pnpm format:check` | Build: `pnpm build`
- Unit tests: `pnpm test` | DB integration tests (Docker running): `pnpm test:int`
- Contracts: `pnpm --filter @eticket/contracts lint` | regenerate types: `pnpm --filter @eticket/contracts generate`
- Ticket Service only: `pnpm --filter @eticket/ticket-service test` (unit) and `pnpm --filter @eticket/ticket-service test:int` (integration)
- Contract suite against a running target: `CONTRACT_BASE_URL=… CONTRACT_API_KEY=… CONTRACT_INTERNAL_API_KEY=… pnpm --filter @eticket/contract-tests test:contract`
- Local env: `cp infra/.env.example infra/.env` and set passwords
- Stack: `docker compose -f infra/docker-compose.yml up -d --build`
- Verify DB + migrations: `infra/scripts/verify-db.sh` | Reset DB: `docker compose -f infra/docker-compose.yml down -v`
- Migrations are hand-written SQL (ADR-0015). Never run `prisma migrate dev`.
- .NET: `dotnet build`, `dotnet test`, `dotnet format --verify-no-changes`
- Before saying a phase is done: lint, build, test and test:int must pass.
