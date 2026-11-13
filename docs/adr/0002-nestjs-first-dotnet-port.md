# ADR-0002: NestJS for all services first; Ticket Service ported to .NET

## Context

The challenge mandates C#/.NET for at least one core service, names the Ticket
Service as the .NET candidate, and suggests Node/Go for Payment and "Python or
similar" for Ledger. The author is strongest in TypeScript, the budget is 3–5
days, and the interview rewards explaining every service.

## Decision

Build all backend services in NestJS first, sharing tooling, config and test
infrastructure. Then port the Ticket Service to ASP.NET Core
(`apps/ticket-service-dotnet`) against the **same OpenAPI contract**, gated by
the same black-box contract suite, and switch docker-compose and K3s to the
.NET image.

Scope guard: the .NET service is the one item that can never be cut.

- The port starts no later than the start of day 3, whatever state the other
  NestJS services are in. Phases 3–4 continue after it if needed.
- If time runs short, cut in this order: backoffice polish, SonarCloud,
  coverage report, extra contract cases. Never the .NET Ticket Service.

Migration ownership after the port: the `tickets` schema keeps its Prisma
raw-SQL migrations in `apps/ticket-service`, run by its migrate container/Job.
The NestJS service stays in the repo as the contract reference
implementation. The .NET service maps the existing schema with EF Core and
runs no migrations, so there is one schema history, not two.

## Alternatives

- **Ticket Service in .NET from day one**: no double build, and the mandated
  item is done first. Rejected because the least familiar stack would block
  the first end-to-end flow; the port also makes the contract boundary
  concrete and demonstrable.
- **Ledger as the native .NET service**: smallest service, no schedulers.
  Rejected because the challenge names the Ticket Service for .NET.
- **Ledger in Python**: a third runtime and test stack for no scored benefit.

## Trade-off

Ticket logic is written twice (expiry job, confirm policy, tests), and the
NestJS copy is no longer deployed after Phase 5. Accepted: the contract suite
makes the port mechanical to verify, and the hard start date protects the
mandated deliverable.
