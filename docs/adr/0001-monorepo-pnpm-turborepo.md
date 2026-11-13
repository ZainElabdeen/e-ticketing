# ADR-0001: Monorepo with pnpm workspaces + Turborepo

## Context

Five deployables (web, gateway, ticket, payment, ledger) plus shared contracts
and config, built by one person in 3–5 days, reviewed in one repository.

## Decision

Single monorepo using pnpm workspaces for dependency management and Turborepo
for task orchestration (`lint`, `build`, `test` with caching). The .NET port
lives in the same repo (`apps/ticket-service-dotnet`) outside pnpm, wired into
CI separately.

## Alternatives

- **Repo per service**: closer to real microservice ownership, but multiplies
  CI setup and review overhead for a challenge-sized project.
- **npm/yarn workspaces without Turbo**: works, but no task graph or caching;
  Turbo's `--filter` also drives per-app CI path filtering.

## Trade-off

Monorepo blurs deploy independence (mitigated: separate Docker images and CI
path filters per app). Accepted for development speed and a single reviewable
history.
