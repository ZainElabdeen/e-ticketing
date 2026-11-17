# ADR-0031: Remove the NestJS Ticket Service

Status: Accepted. Supersedes in part [ADR-0002](./0002-nestjs-first-dotnet-port.md)
and [ADR-0021](./0021-ticket-service-dotnet-port.md).

## Context

The challenge names the Ticket Service as the C#/.NET service. Since Phase 5 the
deployed Ticket Service is the ASP.NET Core one. The NestJS version only ran
under a compose profile, yet it still held the `tickets` migrations and the
schema tests. Reviewers had to ask which implementation is real.

## Decision

- Delete `apps/ticket-service`.
- Move the tickets SQL migrations unchanged into `apps/ticket-service-dotnet/prisma`.
  They are still applied by `prisma migrate deploy` in the `migrate-tickets` image.
- Port the schema tests to xUnit (`SchemaConstraintsTests.cs`).
- Keep the old code on the branch `archive/ticket-service-nestjs`.

## Alternatives

- Keep it as a reference implementation: rejected. Two implementations have to be
  kept in step, and it is confusing.
- Switch the migrations to EF Core or DbUp: rejected. It adds a new tool and
  re-baselines the migration history already applied in production.

## Trade-off

There is no second implementation to diff against. The contract suite run against
the .NET service is the behaviour gate.
