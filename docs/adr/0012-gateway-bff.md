# ADR-0012: A NestJS gateway as backend-for-frontend

## Context

The challenge lists ticket, payment and ledger services but no edge. The
browser must never hold API keys; the backoffice needs login; rate limiting
and CORS need one home.

## Decision

`apps/gateway` (NestJS) is the only public backend. Its scope is deliberately
thin: hold public-scope API keys, verify backoffice JWTs and issue them at
login, rate limit, CORS and security headers, issue correlation IDs, and proxy
requests 1:1 to services. No business logic, no aggregation, no database.

## Alternatives

- **Traefik middlewares only** (forward-auth, rate limit, headers): no extra
  service, but key injection per route and the login endpoint would still need
  a small service; logic would split across YAML and code.
- **SPA calls services directly**: keys would ship to the browser.

## Trade-off

One more hop and one more deployable. Accepted: it is where every security
control the challenge asks about lives, which makes it easy to explain.
