# Contracts

OpenAPI is the source of truth for every service (ADR-0013). Workflow and
commands: `README.md` here; step-by-step change procedure: the `contract-change`
skill.

Gotchas the README leaves implicit:

- Consumers read the bundled `dist/*.json` (package `exports`), not the YAML.
  `dist/` is gitignored; turbo builds it via `^build`, but running a
  `test:contract:*` script or the .NET build directly needs
  `pnpm --filter @eticket/contracts build` first.
- `check:generated` uses `git diff`, which misses a brand-new untracked
  generated file; `git status --short src/generated` catches both.
- Shared shapes live in `openapi/common.yaml`; reference them, never copy.
- A Ticket Service contract change binds the .NET Ticket Service.
