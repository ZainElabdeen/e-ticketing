Read AGENTS.md and docs/challenge.md first. docs/challenge.md is the source
of truth; if AGENTS.md conflicts with it, tell me before doing anything.

You are building my submission for a Full-Stack Engineer code challenge. I must
explain every service, the schema and the ledger flow in an interview, so work
in phases, STOP after each phase for my review, and end each phase with:
(1) what was built, (2) the decisions and why, (3) how I can test it myself.

## Phases
0. Spec: write docs/spec.md, ADRs in docs/adr/, and OpenAPI contracts for all
   services in packages/contracts. Have the spec reviewed by a fresh subagent
   with no context and fix the gaps. No application code yet.
1. Monorepo scaffold, docker-compose, DB schemas and migrations. Update the
   Commands section of AGENTS.md.
2. Ticket Service (NestJS) + a contract test suite that runs against any
   base URL.
3. Payment Service: handlers, idempotency, outbox. Unit tests for payment logic.
4. Ledger Service. Unit tests for ledger posting.
5. Port Ticket Service to .NET. It must pass the same contract tests.
   Switch docker-compose to the .NET version.
6. Gateway + backoffice auth.
7. Web app: ticket selection, checkout, result page, backoffice.
8. GitHub Actions: lint, build, test, Docker image build per app with path
   filters, push to GHCR, coverage report, SonarCloud.
9. K3s manifests, deploy guide, README with architecture diagram (Mermaid),
   service responsibilities, local run, deploy, environment variables,
   API examples, assumptions and trade-offs.

Start with Phase 0 now. Ask me only if a decision cannot be changed later.
