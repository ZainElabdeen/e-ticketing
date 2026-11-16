# ADR-0030: Shared health module and graceful shutdown drain

Builds on ADR-0020 (shared `@eticket/nest-common`). Deviates from one rule of the
`nest-ddd-architecture` skill (section 11) for the gateway; see decision 6.

## Context

Each Nest service carried its own copy of the health controller, the Prisma
readiness query and the `main.ts` bootstrap. None of them told the load balancer
to stop routing before the HTTP server closed, so a rolling restart could drop
in-flight requests. The contract Health body (`status`, `details`) is asserted
by the contract suites and must not change.

## Decision

1. `@eticket/nest-common` owns `HealthModule.forRoot({ checks, imports,
   timeoutMs, drainMs })` (timeout default 2000 ms), built on Terminus so the
   response keeps the contract Health body shape. `@nestjs/terminus` and
   `@nestjs/config` are peer dependencies (both already project packages).
2. A service supplies `ReadinessCheck` classes (`name`, `check()`). The shared
   `prismaReadinessCheck(token)` (name `database`) replaces the three copies;
   each app keeps its own `PrismaModule`. `/health/live` never touches a
   dependency.
3. `ShutdownState` fails readiness in `beforeApplicationShutdown` (indicator
   `shutdown`, reason `shutting_down`) and waits `SHUTDOWN_DRAIN_MS` (0-30000,
   default 5000, tests 0) before Nest closes the HTTP server. Probes and
   proxies see 503, stop routing, and in-flight requests finish.
4. The drain sits inside the platform grace period: compose
   `stop_grace_period: 20s` for the Nest services; K8s Nest pods use the 30 s
   default (the .NET Ticket Service keeps its own 20 s).
5. Bootstrap helpers `resolveContractFile`, `bootstrapService` and `runIfMain`
   replace the per-service `main.ts` boilerplate. The shared module carries no
   throttle metadata: the gateway's own throttler guard exempts exactly
   `/health/live` and `/health/ready`.
6. **Deviation:** the gateway's readiness checks its downstream services'
   `/health/live` (keys `ticket-service`, `payment-service`, `ledger-service`
   kept). The skill forbids readiness depending on downstream services, but the
   single-replica BFF can serve nothing without them, and the contract suites
   (`assertGateway`) rely on `details`.

Measured: `docker compose stop gateway` took 5.29 s; during the drain
`/health/ready` returned 503 with `shutdown: shutting_down`.

## Alternatives

- Keep per-service controllers: three drifting copies, no drain.
- Hand-rolled health without Terminus: would have to re-create the body shape.
- Gateway `/health/deep` for downstream checks with plain readiness (own DB-less
  process check): the purist fix, rejected for now because it changes the
  contract and the suites; revisit if the gateway is ever scaled out.
- Drain via a Kubernetes `preStop` sleep: does not help compose or local runs.

## Trade-off

Every stop waits up to 5 s even when idle, and the grace periods must stay above
drain plus in-flight work. The gateway can report not-ready when a downstream is
down, which cuts off routes that do not need that service; acceptable with one
replica.
