# ADR-0016: Contract tests validate responses with Ajv against the bundled contract

## Context

The Ticket Service is built in NestJS first and later ported to ASP.NET Core
against the same OpenAPI contract. The black-box contract suite is the gate for
both implementations, so it needs an oracle for response shapes that does not
depend on either implementation and does not drift from the contract.

## Decision

- `@eticket/contracts` bundles and dereferences each OpenAPI YAML with
  `redocly bundle --dereferenced` into `dist/<service>.json`, exported as
  `@eticket/contracts/openapi/<service>.json`.
- `@eticket/contract-tests` loads that JSON, indexes operations by
  `operationId`, and validates each response status and body with Ajv 8 plus
  ajv-formats (`strict: false`, `allErrors: true`). Ajv 8 understands the
  OpenAPI 3.0 `nullable` keyword.
- The YAML itself is therefore the oracle for NestJS and for the .NET port.

## Alternatives

- Hand-written assertions on every field: they restate the contract in a second
  place and can drift from it silently.
- `jest-openapi`: lightly maintained and tied to one response shape.

## Trade-off

Two extra dev dependencies (`ajv`, `ajv-formats`). Ajv checks shapes, not
behavior, so the suite's own assertions still check behavior (quota counters,
status transitions, error codes).
