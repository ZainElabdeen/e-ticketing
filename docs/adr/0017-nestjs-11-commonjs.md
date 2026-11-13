# ADR-0017: NestJS 11 (CommonJS line), pinned at 11.2.10

## Context

NestJS 12 is ESM-only. The repository is CommonJS: ts-jest compiles to CJS,
Prisma's generator uses `moduleFormat = "cjs"`, and the service starts with
`node dist/src/main.js`. The NestJS apps share this setup.

## Decision

Pin every NestJS package to 11.2.10, the last line that ships CommonJS, and
keep the existing toolchain.

## Alternatives

- Migrate every Nest app to ESM now (module resolution, Jest ESM mode, Prisma
  output format, start command). Large cross-cutting change with no functional
  benefit for this challenge.

## Trade-off

A later move to NestJS 12 needs an ESM migration of all Nest apps at once. It
is deferred until there is a reason to take it.
