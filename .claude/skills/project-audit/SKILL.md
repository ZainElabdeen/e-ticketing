---
name: project-audit
description: Use when asked for a repo-wide audit, health check or engineering assessment, or to refresh docs/engineering/initial-assessment.md. Read-only, parallel per-area review with evidence, verification and a remediation roadmap.
---

# Project audit

Read-only. The audit changes no source file; fixes are a separate,
user-approved task.

## Steps

1. **Baseline**: `git status` (clean or noted), branch and commit hash. Read
   `docs/engineering/initial-assessment.md` for known findings, and the
   carry-forward list in the latest plan, so they are not re-reported.
2. **Split by area** and review in parallel (subagents when available, one per
   area):
   - web: `apps/web` and the nginx config;
   - NestJS: the four Nest apps, `packages/nest-common`, `packages/testing`;
   - .NET: `apps/ticket-service-dotnet`;
   - infra and contracts: `infra/`, `packages/contracts`,
     `packages/contract-tests`, root config.
3. **Each reviewer** gets: the area's `AGENTS.md`, the relevant spec sections and
   ADRs, the known-findings list, the read-only rules (no edits, no `.env`
   reads, no installs, unit tests allowed), and the 14 dimensions:
   architecture, dependency boundaries, organisation, type safety, framework
   practice, UI/UX, responsive, accessibility, performance, security, testing,
   build and deploy, maintainability, developer experience. For the web area,
   the passes of the `web-review` skill.
4. **Each reviewer returns** a findings table (severity, `file:line`,
   evidence, fix), areas checked clean, areas not checked, and new local
   conventions not yet in an `AGENTS.md`.
5. **Verify**: re-check every Critical, High and Medium finding in code
   yourself. Downgrade or drop findings that a spec section or ADR documents as
   a deliberate choice, and say so.
6. **Write** `docs/engineering/initial-assessment.md`: summary, test runs,
   findings (with a verified / reported column), checked clean, not checked,
   remediation roadmap ordered by risk and mapped to phases.
7. **Feed back** new local conventions into the area `AGENTS.md` files.

## Done when

All four areas were reviewed across all 14 dimensions (or marked not checked
with the reason), every Medium-or-higher finding was verified in code, and the
assessment and roadmap are written.
