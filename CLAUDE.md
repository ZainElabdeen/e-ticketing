@AGENTS.md

## Claude Code only
- Phase 0 (spec): use the EGM skills to draft `docs/spec.md`, run the
  zero-context review, fix the gaps. After each later phase run the EGM
  drift check against the spec.
- Phases 1+: use Superpowers (write plan, TDD, subagent execution, code
  review). Do not re-plan what the spec already decided.
- UI work: use the frontend-design skill.
- Decision questions (e.g. spec gaps found while writing a plan): batch them,
  give every option its pros and cons, mark one "(Recommended)" and say why.
- Every plan in `docs/plans/` ends with an "Execution options" section:
  (A) Claude subagents on Sonnet, or (B) hand-off to OpenCode with a
  ready-to-paste `opencode run` command. Plans must be self-contained so either
  agent can run them. After OpenCode runs, Claude reviews and runs the drift check.

## Model routing

- Main session (Opus 5.5): spec, brainstorming, planning, review, orchestration.
- Plan execution runs in subagents (Sonnet 5.5, the default subagent model via
  `.claude/settings.local.json`). Prefer subagent-driven execution over inline.
  If executing inline, switch first with `/model sonnet`.
