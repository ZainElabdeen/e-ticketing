# Instruction system validation

Run on branch `ai-instructions` (off `dev` at `8a45315`), 2026-11-15.

## Results

| # | Check | Result | Status |
|---|---|---|---|
| 1 | Skill frontmatter starts on line 1, `name` equals the folder, kebab-case ≤ 64 chars | 5 / 5 | Verified |
| 2 | Skill `description` present, trigger first, ≤ 1,024 chars (listing cap 1,536) | 5 / 5 (≈ 160–210 chars) | Verified |
| 3 | Every skill ends with checkable "Done when" conditions | 5 / 5 | Verified |
| 4 | Every nested `CLAUDE.md` is exactly `@AGENTS.md` beside an `AGENTS.md` | 9 / 9 | Verified |
| 5 | Paths named in new files exist (script plus manual review of misses) | All exist; misses were package names, per-app relative paths (checked in all four Nest apps) and intentionally absent `.claude/rules/` | Verified |
| 6 | Claude Code loads a nested `CLAUDE.md` on first edit in that folder | Observed live for `apps/ticket-service-dotnet` and `infra` | Verified |
| 7 | `@AGENTS.md` resolves relative to the importing file | Official docs (code.claude.com/docs/en/memory) | Verified (docs) |
| 8 | OpenCode loads nested files via `instructions` globs and skills from `.claude/skills` | Official docs (opencode.ai/docs/rules, /docs/skills); `opencode.json` parses | Partially verified: not run in OpenCode |
| 9 | Frontend rules stay out of backend areas and vice versa | Web rules only in `apps/web`; Nest rules only in `packages/nest-common` + the four Nest apps; .NET rules only in its folder | Verified |
| 10 | Monorepo guidance matches the tool | Turborepo + pnpm only; no Nx concepts | Verified |
| 11 | Technology references match manifests | Every library named appears in a `package.json` or `.csproj`; no new dependency | Verified |
| 12 | Duplication with root `AGENTS.md` | Two repeats found and removed (dotnet wrapper, compose naming); remaining overlap is a link or an area-specific detail | Verified |
| 13 | Conflicts | None found between nested files, root rules, spec and ADRs | Verified (manual review) |
| 14 | Existing instructions preserved | Root `AGENTS.md` and `CLAUDE.md` content unchanged except the added instruction map; `opencode.json` keeps its entries | Verified (`git diff`) |
| 15 | Root `CLAUDE.md` stays concise | Unchanged (22 lines) | Verified |
| 16 | Prettier on all new and changed files | Clean | Verified |

## Coverage

| Area | Nested rules | Skills that apply |
|---|---|---|
| `apps/web` | yes | `ui-walkthrough`, `contract-change`, `phase-gate` |
| `apps/gateway` | yes | `contract-change`, `phase-gate` |
| `apps/ticket-service` | yes | `contract-change`, `sql-migration`, `phase-gate` |
| `apps/ticket-service-dotnet` | yes | `contract-change`, `sql-migration` (mapping step), `phase-gate` |
| `apps/payment-service` | yes | `add-payment-method`, `contract-change`, `sql-migration`, `phase-gate` |
| `apps/ledger-service` | yes | `contract-change`, `sql-migration`, `phase-gate` |
| `packages/nest-common` | yes (shared Nest conventions) | `phase-gate` |
| `packages/contracts` | yes | `contract-change` |
| `packages/contract-tests` | no (covered by `contract-change`) | `contract-change` |
| `packages/testing`, `packages/config` | no (no local conventions beyond the root) | — |
| `infra` | yes | `sql-migration`, `phase-gate`, `ui-walkthrough` |

## Unverified

- OpenCode loading behaviour, beyond its docs (row 8).
- Whether skill descriptions trigger reliably: watch for missed triggers in
  real sessions and sharpen the description first.

## Quick re-check

```sh
# Every nested CLAUDE.md is a shim beside an AGENTS.md
for f in $(git ls-files '*/CLAUDE.md'); do
  d=$(dirname "$f"); [ "$(cat "$f")" = "@AGENTS.md" ] && [ -f "$d/AGENTS.md" ] || echo "BAD $f"
done
# Skill name matches folder
for f in .claude/skills/*/SKILL.md; do
  d=$(basename "$(dirname "$f")"); grep -q "^name: $d$" "$f" || echo "BAD $f"
done
```
