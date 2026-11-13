# contracts

Source of truth for every service API and the outbox event payload
(ADR-0013). Behavior lives in [docs/spec.md](../../docs/spec.md); the phase
plan is [docs/PROMPT.md](../../docs/PROMPT.md).

## Layout

```text
openapi/
  common.yaml            # shared components: error envelope, health, pagination,
                         # correlation header, money types (no paths)
  gateway.yaml           # public edge consumed by the SPA
  ticket-service.yaml    # implemented by NestJS AND the ASP.NET Core port
  payment-service.yaml
  ledger-service.yaml
events/
  payment-succeeded.schema.json   # outbox event payload (JSON Schema draft-07)
redocly.yaml             # lint rules
```

## Rules

- OpenAPI 3.0.3 for tool compatibility (@nestjs/swagger, Swashbuckle,
  openapi-typescript, Redocly).
- Written by hand, before the code. A service's `/docs` Swagger UI is
  documentation; these files are the contract.
- Shared shapes are referenced from `common.yaml`; gateway shapes are
  referenced from the service files. Never copy a schema.
- The contract test suite (Phase 2) asserts these shapes against any base URL
  (`CONTRACT_BASE_URL`). The .NET Ticket Service must pass the identical suite
  before compose and K3s switch to it.
- Breaking changes bump `info.version` and need an ADR.

## Commands

Run from the repo root; each filters to this package so `redocly.yaml`
applies.

- Lint the four contracts: `pnpm --filter @eticket/contracts lint`
- Regenerate the committed types in `src/generated/`:
  `pnpm --filter @eticket/contracts generate`
- Fail if `src/generated/` is stale (used in CI):
  `pnpm --filter @eticket/contracts check:generated`
- Type-check this package: `pnpm --filter @eticket/contracts build`
- Single-file bundle: `npx @redocly/cli bundle openapi/gateway.yaml -o dist/gateway.yaml`
- Dereferenced JSON bundle of the Ticket Service contract (`dist/ticket-service.json`, also run by `build`):
  `pnpm --filter @eticket/contracts bundle`

The generated files are committed, so consumers need no codegen step.
