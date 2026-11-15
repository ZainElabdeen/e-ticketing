# Maintaining the agent instructions

How to keep the instruction system (ADR-0024) current without regenerating it.

## Where each kind of rule lives

| Kind | Home |
|---|---|
| Requirements | `docs/challenge.md` |
| Design and decisions | `docs/spec.md`, `docs/adr/` |
| Repo-wide agent rules, stack, commands | root `AGENTS.md` |
| Claude Code-only workflow | root `CLAUDE.md` |
| Area conventions and gotchas | `<area>/AGENTS.md` |
| Multi-step repo workflows | `.claude/skills/<name>/SKILL.md` |
| Audit and inventory snapshots | `docs/engineering/` |

One meaning, one home. A nested file links to the spec or an ADR instead of
restating it, and holds only what an agent cannot find with one file read or one
command.

## When to update

| Change | Update |
|---|---|
| New app or package | Inventory; an `AGENTS.md` + `CLAUDE.md` shim if it has local conventions; the three Dockerfile manifest lists (`infra/AGENTS.md`) |
| New convention found in review | The area `AGENTS.md`, in the same PR as the fix |
| Workflow steps change (scripts, order, tools) | The matching skill |
| Major framework or tool upgrade | Area file and skills that name versions or APIs; check official docs first and note the link and date in the PR |
| A rule stops being true | Delete it in the same change; stale lines are worse than missing ones |
| Phase completed | `phase-gate` report; refresh the inventory if packages changed |

## Rescan procedure

1. List packages: `pnpm -r ls --depth -1` and `ls apps packages`; compare with
   `project-inventory.md`.
2. List instruction files:
   `git ls-files '*AGENTS.md' '*CLAUDE.md' '.claude/skills/*/SKILL.md'`.
3. Run the quick re-check in `instruction-system-validation.md`, and confirm
   every path a nested file or skill names still exists.
4. Check for duplication: a rule appearing in two files keeps one home and the
   other becomes a link.
5. Check `opencode.json` globs still cover every nested `AGENTS.md`.
6. Re-run the audit only for the areas that changed; update
   `initial-assessment.md` findings (mark fixed ones with the commit).

## Writing rules

- Front-load the trigger in a skill `description` (what situation fires it).
- State the target behaviour; use a prohibition only for a hard guardrail.
- Every skill ends with a "Done when" section of checkable conditions.
- Keep root `AGENTS.md` repo-wide; move area detail down to the area file.

## Changelog

| Date | Change |
|---|---|
| 2026-11-15 | Layered system introduced (ADR-0024): nine area files, five skills, engineering docs. |
