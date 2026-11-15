# ADR-0024: Layered agent instructions

## Context

Root `AGENTS.md` (imported by `CLAUDE.md`) held every agent rule. As the repo
grew to six apps and five packages, area knowledge (CSP constraints in the SPA,
.NET parity quirks, the contract and migration workflows, Docker host safety)
lived only in review notes and session memory. Agents rediscovered it or broke
it. Two tools work in this repo: Claude Code and OpenCode.

## Decision

- **Root `AGENTS.md`** stays the single source of repo-wide rules, with a short
  instruction map.
- **Nested `AGENTS.md`** per area with local conventions: `apps/web`,
  `apps/gateway`, `apps/ticket-service`, `apps/payment-service`,
  `apps/ledger-service`, `apps/ticket-service-dotnet`, `packages/nest-common`
  (shared NestJS conventions), `packages/contracts`, `infra`. Each holds only
  facts an agent cannot cheaply look up and that the root does not state.
- **A one-line `CLAUDE.md` (`@AGENTS.md`)** next to each nested `AGENTS.md`.
  Claude Code loads a subdirectory `CLAUDE.md` when it first reads a file there;
  the import resolves relative to that file. This mirrors the root pattern. The
  four NestJS apps' shims also import `../../packages/nest-common/AGENTS.md`,
  so the shared Nest rules load without relying on a pointer.
- **OpenCode** loads the nested files through globs in `opencode.json`
  `instructions`.
- **Eight workflow skills** in `.claude/skills/`, all specific to this repo:
  `contract-change`, `sql-migration`, `add-payment-method`, `phase-gate`,
  `ui-walkthrough`, `web-review` (React, UI/UX, tokens, accessibility,
  responsive, performance), `repo-review` (diff review against the payment,
  ledger, contract and security invariants) and `project-audit` (read-only
  parallel audit). Both Claude Code and OpenCode discover skills there.
- **React standards** live in `apps/web/AGENTS.md`, written for this app's
  stack (TanStack Query, React Hook Form + Zod, CSS Modules under a strict CSP).
- **No generic, stack-agnostic skills**: review and React guidance is written
  against this repo's rules so it is visible to every tool and reviewer, not
  only to one developer's global setup. `repo-review` is not named
  `code-review` to avoid shadowing the built-in skill of that name.
- **`docs/engineering/`** holds the audit, inventory, validation report and
  maintenance guide. Architecture and decisions stay in `docs/spec.md` and
  `docs/adr/`.

## Alternatives

- **`.claude/rules/` with `paths:` frontmatter**: native path scoping, but Claude
  Code only; OpenCode would miss every rule.
- **`docs/agents/*.md` reached by pointers**: one folder, but loading depends on
  pointer wording rather than the file being edited.
- **Full generic template** (about 16 skills, 7 engineering docs): duplicates the
  spec, ADRs and global skills.

## Trade-off

Two files per area (the shim is one line), and OpenCode loads all nested files
at startup rather than per directory. Nested files must be kept current; the
maintenance guide gives the rescan procedure. A developer without the global
skills gets less general guidance, by design.
