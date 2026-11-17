# Project inventory

Snapshot of `dev` at `8a45315` (2026-11-15). Regenerate with the steps in
`maintenance-guide.md`. Architecture and responsibilities: `docs/spec.md` §2.
Library choices and versions: root `AGENTS.md` (Stack, Packages) and the
manifests.

## Workspace

- pnpm 10.34.9 workspaces (`apps/*`, `packages/*`) + Turborepo 2.11.11.
- Root gate: `pnpm lint | format:check | build | test | test:int`.
- Node ≥ 26 (`.nvmrc`), .NET SDK 10.0.404 (`global.json`).
- Planned, not built yet: GitHub Actions (Phase 8), K3s manifests (Phase 9).

## Apps

| Package | Path | Kind | Framework | DB schema | Unit / integration tests |
|---|---|---|---|---|---|
| `@eticket/web` | `apps/web` | SPA | React + Vite | — | Vitest + Testing Library (jsdom) |
| `@eticket/gateway` | `apps/gateway` | BFF, public edge | NestJS | — | Jest / Jest + Supertest |
| `@eticket/ticket-service-dotnet` | `apps/ticket-service-dotnet` | service (runs in compose) | ASP.NET Core + EF Core | `tickets` (owner of migrations) | xUnit `Category=Unit` / `Category=Integration` |
| `@eticket/payment-service` | `apps/payment-service` | service | NestJS + Prisma | `payments` | Jest / Testcontainers |
| `@eticket/ledger-service` | `apps/ledger-service` | service | NestJS + Prisma | `ledger` | Jest / Testcontainers |

## Packages

| Package | Path | Purpose | Consumers |
|---|---|---|---|
| `@eticket/contracts` | `packages/contracts` | OpenAPI YAML, generated TS types, bundled JSON | every app, `contract-tests` |
| `@eticket/contract-tests` | `packages/contract-tests` | black-box suites against any base URL | Nest apps (`contract.int-spec.ts`), `infra/scripts/contract.sh` |
| `@eticket/nest-common` | `packages/nest-common` | guard, error envelope, logging, validation, money helpers | the three Nest apps |
| `@eticket/testing` | `packages/testing` | Testcontainers Postgres, HTTP stub | Nest apps' integration tests |
| `@eticket/config` | `packages/config` | shared ESLint flat config, tsconfig, Jest presets | all TS packages |

## Infra

| Path | Content |
|---|---|
| `infra/docker-compose.yml` | Postgres, three migrate jobs, four services, gateway, nginx web |
| `infra/docker/` | `nest-service`, `dotnet-ticket`, `web` Dockerfiles; nginx config and header snippet |
| `infra/migrate/` | Prisma `migrate deploy` runner image |
| `infra/postgres/init/` | roles and schemas bootstrap (`00-roles.sh`) |
| `infra/scripts/` | setup, admin hash, seed, smoke, contract runner, DB verify (+ `node --test` suites) |

## Agent instructions

| File | Scope |
|---|---|
| `AGENTS.md` (+ `CLAUDE.md` import) | repo-wide rules, stack, commands |
| `CLAUDE.md` | Claude Code-only workflow and model routing |
| `<area>/AGENTS.md` (+ `CLAUDE.md` shim) | area conventions, nine areas (ADR-0024) |
| `.claude/skills/*/SKILL.md` | eight repo workflows |
| `opencode.json` | OpenCode instruction globs and MCP servers |
