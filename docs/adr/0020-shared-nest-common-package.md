# ADR-0020: Shared NestJS plumbing in `@eticket/nest-common`

## Context

Phase 2 put the HTTP plumbing (API-key guard, error envelope, correlation ID,
validation pipe, logging, docs, fallback route, DB helpers) inside the Ticket
Service. The Payment and Ledger services need the same code, and the Phase 2
key-scope fix (ADR-0018) showed that a security fix must land everywhere at
once.

## Decision

- The plumbing lives in one workspace package, `packages/nest-common`.
- It is compiled to `dist/` (CommonJS plus declarations), because apps run
  `node dist/src/main.js` and need compiled JavaScript for it.
- Every Nest-related dependency is a peerDependency (with the same pinned
  version in devDependencies), so an app and the package share one
  `@nestjs/core`; two copies would break `Reflector` and DI.
- Per-service differences are parameters: `API_KEYS` provider (`internalKey`
  optional), `pinoHttpOptions({ service, ... })`, `schemaOf(url, fallback)`,
  and an absolute `contractFile` for `configureApp`.
- `PrismaService` and `HealthController` stay in each app, since they use the
  app's generated Prisma client.

## Alternatives

- Copy the code per service: drift, and four copies of security code.
- Publish to a registry: needless for a private monorepo.

## Trade-off

The Ticket Service now depends on a workspace package, so builds must build it
first (Turbo `^build` does) and the Docker build must include it (Task 9).
