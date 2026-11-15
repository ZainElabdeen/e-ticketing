# Gateway (BFF)

Shared Nest conventions: `packages/nest-common/AGENTS.md` (read it first).
No database. Spec §2, §6; ADR-0012, 0018, 0022.

- **Edge, not a guard target**: no `ApiKeyGuard`. The gateway holds
  `PUBLIC_API_KEY_{TICKET,PAYMENT,LEDGER}` and calls downstream through
  `DownstreamClient.send` / `relay`, which pass status and JSON through. A
  downstream 401/403 becomes 502 (the browser must never see a key problem).
- **Bodies are relayed**, validated downstream. Path params go through
  `pathSegment()`.
- **New endpoint**: contract first in `packages/contracts/openapi/gateway.yaml`
  (follow the `contract-change` skill), then the controller method. Swagger
  serves the bundled contract (`contractFile()` in `main.ts`), not decorators.
- **Rate limits**: add the scope to `throttling/rate-limit.ts`, the `limits` in
  `throttling.module.ts` and the env class, then tag with `@RateLimit(scope)`.
  `RATE_LIMIT_WINDOW_MS` is test-only.
- **Backoffice**: `@UseGuards(JwtAuthGuard)`; the admin hash comes from
  `ADMIN_PASSWORD_HASH_B64`. Extra log redaction goes through `extraRedact`.
- `TRUST_PROXY` is the proxy hop count; behind nginx/Traefik it must be ≥ 1 or
  every client shares one rate-limit bucket.
