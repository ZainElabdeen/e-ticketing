# ADR-0018: API key scope enforcement in the Ticket Service

## Context

Two key scopes exist (ADR-0010): the public key and the internal key. Internal
routes (`/v1/internal/*`) must reject the public key. Express routes are
case-insensitive by default, and guards only run on matched routes, so a
path-only check or an unmatched path could bypass or skip the scope check.

## Decision

- Internal routes carry `@Internal()` metadata. `ApiKeyGuard` reads it; this is
  the primary control, independent of the URL.
- A normalized path-prefix check (lower-cased, repeated slashes collapsed) on
  `/v1/internal/` runs as defense in depth, for a route that forgot the marker.
- Express case-sensitive routing is enabled, so `/V1/Internal/...` cannot reach
  an internal handler by differing only in case.
- A catch-all fallback route is registered last, so the guard also runs on
  unknown paths: unknown path with no key gives 401, with a valid key 404.
- The internal key is also accepted on public routes, because the Payment
  Service calls `GET /v1/orders/{id}` with it.

## Alternatives

- Path-only check: bypassable by URL case or path normalization differences.
- Guard-free middleware on the path: duplicates routing and has the same
  normalization risks, and loses per-route metadata.

## Trade-off

Two overlapping checks and a fallback controller to maintain. The .NET port
must give the same contract-visible results (401 without a key, 403 for the
public key on internal routes, 404 otherwise). The 401-on-unknown-route
behaviour is not part of the contract and may differ.
