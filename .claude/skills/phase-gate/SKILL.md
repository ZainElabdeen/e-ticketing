---
name: phase-gate
description: Use before saying a phase, task or branch is done, before a merge, or when asked to verify the repo. Runs the full lint/format/build/test gate, smoke and spec drift check, and writes the phase report.
---

# Phase gate

Evidence before claims: every step below ends on a command's exit code or
output, quoted in the report. Commands and prerequisites: root `AGENTS.md`
(Commands).

## Steps

1. `git status` → note uncommitted files; the gate runs on what will merge.
2. `pnpm lint` → exit 0.
3. `pnpm format:check` → exit 0.
4. `pnpm build` → exit 0.
5. `pnpm test` → exit 0 (includes `node --test infra/scripts/`).
6. `pnpm test:int` → exit 0 (Docker running).
7. `pnpm --filter @eticket/contracts check:generated` → exit 0 (also fails on
   untracked generated files).
8. **Runtime check** when services, infra or contracts changed:
   `infra/scripts/smoke.sh` → ends with `SMOKE OK`. It runs `down -v`, so ask
   first if the local stack holds data the user needs. Contract-affecting
   change: the four suites via `infra/scripts/contract.sh` (ticket first).
9. **Drift check** against `docs/spec.md` and `docs/adr/` (Claude Code: the EGM
   drift check). Every deviation is fixed or recorded as an ADR amendment.
10. **Carry-forward**: deferred findings go into the next phase's plan.

## Report (docs/PROMPT.md format)

1. What was built.
2. Decisions and why (link ADRs).
3. How the user can test it themselves (exact commands, URLs).

Plus a gate table: step, command, result. A step that was skipped or failed is
listed as such, with its output.

## Done when

Steps 2–7 exit 0, step 8 ran or is recorded as not applicable, the drift check
lists zero unrecorded deviations, and the report is written.
