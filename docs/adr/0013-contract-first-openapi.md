# ADR-0013: Hand-written OpenAPI 3.0.3 contracts, written before code

## Context

The Ticket Service will exist in two implementations (NestJS, then .NET), the
SPA needs typed clients, and the challenge asks for Swagger.

## Decision

Contracts live in `packages/contracts/openapi/` and are written before the
services. Shared components (error envelope, health, pagination, correlation
header, API key scheme) live in `common.yaml` and are referenced, not copied.
Version 3.0.3, because @nestjs/swagger, Swashbuckle, openapi-typescript and
Redocly all support it. Services serve Swagger UI from their own code; the
contract test suite checks that what they serve matches these files.

## Alternatives

- **Code-first** (generate the spec from NestJS decorators): no hand-written
  YAML, but the .NET port would have to match a document produced by the code
  it replaces.
- **OpenAPI 3.1**: closer to JSON Schema, but uneven tool support.

## Trade-off

Two sources (YAML and code) can drift. The contract suite is the guard;
`redocly lint` runs in CI.
