# ADR-0019: `@nestjs/axios` for service-to-service HTTP

## Context

The Payment Service calls the Ticket Service (read order, confirm order) and
the Ledger Service (post journal entry). Every call needs a timeout, an API key
header, a correlation ID, no redirect following, and a uniform mapping of
failures to `UPSTREAM_TIMEOUT` (504) and `UPSTREAM_UNAVAILABLE` (502). The
outbox worker retries on those errors, so the mapping must be exact.

## Decision

- Use `@nestjs/axios` 4.0.1 with `axios` 1.21.1, both pinned exactly. The user
  chose this on 2026-11-14.
- `HttpModule.registerAsync` sets `timeout` from `DOWNSTREAM_TIMEOUT_MS`,
  `validateStatus: () => true` (the clients map statuses themselves) and
  `maxRedirects: 0`.
- `TicketClient` and `LedgerClient` expose Promise-returning methods built on
  `firstValueFrom`. No Observable appears in their public API.
- Axios `ECONNABORTED`, `ETIMEDOUT` and `ERR_CANCELED` map to
  `UpstreamTimeoutError`. Every other transport error and every unexpected
  status maps to `UpstreamUnavailableError`. Messages carry the downstream name
  and the status or error code only: never a key, URL or body.
- Axios `timeout` is only an idle timeout, so every call also carries an
  `AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS)` hard total timeout (see the
  ADR-0006 amendment).

## Alternatives

- Node's built-in `fetch`: no dependency, but timeout, status and error
  plumbing would be hand-written and duplicated in both clients.
- `openapi-fetch`: AGENTS.md lists it for the web app only; the server side
  gains nothing from generated types for three endpoints.

## Trade-off

Two extra dependencies, and RxJS at the call sites inside the clients. The
`firstValueFrom` boundary keeps RxJS out of the rest of the service.
