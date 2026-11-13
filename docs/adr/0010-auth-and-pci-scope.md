# ADR-0010: Scoped API keys between services, JWT backoffice, PAN never stored

## Context

The challenge requires API-key (or client ID/secret) security, input
validation and no committed secrets. Card numbers pass through the payment
simulation. The gateway is the most exposed component.

## Decision

- **Scoped API keys** in `X-Api-Key`, from env (K8s Secrets when deployed):
  - *public scope*, one per service, held by the gateway, accepted on `/v1/*`
    except `/v1/internal/*`;
  - *internal scope*, for Ticket and Ledger, held only by the Payment Service,
    required on `/v1/internal/*`.
  A compromised gateway therefore cannot confirm orders or post to the
  ledger. The gateway also has no route to `/v1/internal/*`, but the key scope
  is the actual control.
- **Backoffice**: `POST /v1/auth/login` checks one admin (`ADMIN_EMAIL`,
  bcrypt `ADMIN_PASSWORD_HASH`, cost 12) and issues an HS256 JWT (1 h; claims
  `sub`, `iat`, `exp`, `iss`). Login is limited to 10/min per IP.
- **Card data**: PAN and CVC exist only in request scope. Stored:
  `card_last4`. The idempotency hash uses last4, not the PAN. Logs redact
  `card.number`, `card.cvc`, `authorization`, `x-api-key`.

## Alternatives

- **One key per service, any caller**: simpler, but the gateway's key would
  unlock internal endpoints.
- **mTLS between services**: stronger, heavy to operate on a single K3s node.
- **OAuth2 client credentials**: the challenge accepts API keys; an auth server
  is overhead here.
- **User table for backoffice**: out of scope for "simple authentication".

## Trade-off

Static keys do not rotate automatically, and JWTs are revoked only by expiry.
Accepted for scope; both change through env without code changes. Not storing
or hashing the PAN keeps the simulation out of card-data storage concerns.
