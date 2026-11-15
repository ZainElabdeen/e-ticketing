# ADR-0025: CI pipeline and coverage

## Context

Spec §11 Phase 8 and `docs/PROMPT.md` Phase 8 ask for GitHub Actions: lint, build,
test, integration test, container images, smoke and contract suites, and a quality
gate. Coverage has to come from every test runner (Jest, Vitest, `dotnet test`) and
must not slow local `pnpm test`.

## Decision

- **Hosting.** The repo is public. The user creates the SonarCloud organization
  (`zainelabdeen`), two projects (TypeScript: `ZainElabdeen_e-ticketing`; C#:
  `ZainElabdeen_e-ticketing-dotnet`) and the `SONAR_TOKEN` secret. The Sonar job
  skips when the secret is absent.
- **Coverage.** Taken from unit AND integration runs, opt-in with `CI_COVERAGE=1`
  (`@eticket/config/jest-coverage`, Vitest `test.coverage`, `apps/ticket-service-dotnet/scripts/test.sh`).
  New test-only dependencies: `@vitest/coverage-v8` (web, pinned to the vitest
  version), `coverlet.collector` (.NET) and `dotnet-sonarscanner` (.NET local tool,
  added in a later task). `CI_COVERAGE` is declared in Turbo `env` for `test` and
  `test:int`, otherwise strict env mode hides it from the runners.
- **arm64.** Built on native `ubuntu-24.04-arm` runners, pushed by digest and merged
  into one manifest. This also verifies the .NET image on arm64.
- **Smoke and contract suites** run on every PR and every push to `dev` and `main`.
- **Branches and publishing.** `main` is the production branch and the GitHub default
  branch. Flow: phase or feature branch, PR to `dev`, release PR `dev` to `main`. Only
  `main` publishes images to GHCR (tags `latest`, `sha-<7>`); PRs and `dev` build both
  architectures without pushing.

Defaults:

- Triggers: `pull_request` to `dev`/`main`, `push` to `dev`/`main`, and
  `workflow_dispatch` (boolean input `all`, default false; true builds every image).
- NuGet audit fails CI on High and Critical only (NU1901 and NU1902 stay warnings).
- Every third-party action is pinned to a full commit SHA with a version comment.
- Two SonarCloud projects, because the generic scanner cannot analyze C#. The
  SonarCloud main branch is `main`.

## Alternatives

- **QEMU arm64 emulation**: one runner, but slow, and it does not truly verify the
  .NET image on arm64.
- **Unit-only coverage**: faster, but the repository and outbox code is exercised
  mainly by integration tests, so the number would mislead.
- **One Sonar project via the MSBuild scanner**: one dashboard, but it forces a
  single build model on a TypeScript and C# repo.
- **Turbo `--affected` instead of path filters**: rejected because image builds need
  per-image Dockerfile and context knowledge that Turbo's graph does not hold.

## Trade-off

A full build runs 16 image jobs (8 images, 2 architectures). Coverage adds roughly
10 to 20 percent to test time, paid only when `CI_COVERAGE=1`. Two Sonar projects
split the dashboard in exchange for working C# analysis.
