---
name: contract-change
description: Use when adding or changing an HTTP endpoint, request or response field, error code, header or status in any service. Contract-first OpenAPI change, type regeneration, the Ticket Service and the contract suites.
---

# Contract change

OpenAPI in `packages/contracts/openapi/` is the source of truth (ADR-0013).
Code follows the contract, never the reverse.

## Steps

1. **Edit the YAML** for the service (`ticket-service`, `payment-service`,
   `ledger-service`, `gateway`). Reuse shapes from `common.yaml`. A breaking
   change bumps `info.version` and needs an ADR in `docs/adr/`.
2. **Gateway mirrors downstream**: a downstream change the browser sees also
   changes `gateway.yaml`.
3. `pnpm --filter @eticket/contracts lint` → no errors.
4. `pnpm --filter @eticket/contracts generate`, then commit `src/generated/*`.
   `git status --short packages/contracts/src/generated` shows exactly the
   files you expect.
5. `pnpm --filter @eticket/contracts build` (refreshes `dist/*.json`, which the
   contract tests and the .NET build read).
6. **Write the failing contract test** in `packages/contract-tests/src/<service>/`
   (the suite that runs against any base URL), plus the service's own unit or
   integration test, then implement.
7. **Ticket Service**: implement in `apps/ticket-service-dotnet`, matching the
   contract's status codes and error envelopes.
8. **Web**: update `apps/web` callers; types come from `@eticket/contracts`.
9. Update `docs/spec.md` where it describes the endpoint.

## Done when

- `pnpm lint`, `pnpm build`, `pnpm test` pass, and `test:int` for every touched app.
- With the stack up, the suites pass in order:
  `infra/scripts/contract.sh ticket`, then `payment`, `ledger`, `gateway`.
  The ticket suite drains VIP quota, so it always runs first.
