# ADR-0022: Gateway auth libraries and the base64 admin hash

## Context

The Gateway signs and verifies backoffice JWTs (spec §4.6, ADR-0010) and checks
one admin password. The images are built for more than one CPU architecture,
and the admin password hash must travel through `.env` files, docker compose
interpolation and shells. A bcrypt hash is full of `$` characters, which
compose and shells treat as variable references.

## Decision

- Use `@nestjs/jwt` (HS256) for tokens and `bcryptjs` (pure JavaScript, cost 12
  or higher) for the password check. The user chose both on 2026-11-14.
  Neither has a native build step, so multi-arch images need no toolchain.
- Store the hash as `ADMIN_PASSWORD_HASH_B64`: base64 of the bcrypt string. The
  value has no `$`, so no escaping is needed anywhere. The Gateway validates it
  at boot (base64, bcrypt shape, cost >= 12) and the error never echoes it.
- `infra/scripts/admin-hash.mjs` produces the value from a password read on
  stdin (echo off on a TTY) and can append `ADMIN_EMAIL` and
  `ADMIN_PASSWORD_HASH_B64` to `infra/.env` when they are missing. It never
  prints the password.
- One admin, from env: `ADMIN_EMAIL` plus the hash. No user table.
- Expiry (1 h) is the only revocation, as in ADR-0010. No denylist, no refresh.

## Alternatives

- `jose`: fine for JWT, but `@nestjs/jwt` plugs into Nest DI with less code.
- Native `bcrypt`: faster, but needs node-gyp or prebuilt binaries per
  architecture.
- Raw hash with `$$` escaping: works in compose only, breaks in shells and
  `--env-file` loaders, and is easy to get wrong.
- A secret file mounted into the container: safe, but adds a mount and a path
  to manage in compose and K3s for a single value.

## Trade-off

`bcryptjs` is several times slower than native bcrypt. One login at cost 12 is
a few hundred milliseconds, acceptable for a single admin and capped by the
login rate limit. Base64 adds one decode step and an extra tool to run once.

Passwords are capped at 72 UTF-8 bytes (login DTO and `admin-hash.mjs`), because
bcrypt silently ignores bytes past 72. The login DTO also caps it at 128 characters per the contract.

## Addendum: downstream 401 and 403

The gateway passes downstream 4xx envelopes through unchanged, with one
exception. A downstream 401 or 403 means the gateway's own API key is missing,
wrong or out of scope. That is a gateway misconfiguration, not a caller error,
so `DownstreamClient` returns 502 `UPSTREAM_UNAVAILABLE` and logs a warn with
the service name and status (never the key).
