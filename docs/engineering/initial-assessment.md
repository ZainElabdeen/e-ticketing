# Initial engineering assessment

Read-only audit of `dev` at `8a45315` (2026-11-15). Four parallel reviewers
(web, NestJS services, .NET port, infra/contracts) read the code and ran unit
suites; every Medium finding was then re-checked against the code by a second
reviewer. No source code was changed.

## Summary

The codebase is in good shape for its stage (Phase 7 of 9). No Critical or High
findings. The payment, idempotency, quota, outbox and ledger invariants are
enforced in both code and database, with integration tests per service. Gaps
cluster in three places: SPA accessibility and error handling, local-stack
resilience scripts, and gates that exist but are not wired in yet.

## Test runs during the audit

| Suite | Result |
|---|---|
| `@eticket/web` test + lint | 20 files, 145 tests pass; lint clean |
| `@eticket/payment-service` test | 10 suites, 63 tests pass |
| `@eticket/ticket-service-dotnet` test | 62 pass |
| `@eticket/contracts` lint | valid, no warnings |
| `node --test infra/scripts/` | 28 / 28 pass |

Not run: integration suites, other services' unit suites, Docker builds, browser.

## Findings

Verification: **V** = re-checked by a second reviewer; **R** = reported by one
reviewer with file evidence, not re-checked.

### Medium

| # | Area | Location | Finding | Fix | Ver |
|---|---|---|---|---|---|
| M1 | web | `apps/web/src/app/router.tsx`, `main.tsx` | No `errorElement` or error boundary; a render error shows the router default page or a blank screen. | Root `errorElement` with a "Start over" link in the app's Banner style. | V, fixed `b9f381c` |
| M2 | web a11y | `apps/web/src/backoffice/BackofficePage.tsx:49-65` | `role="tab"` buttons without roving `tabIndex` or arrow-key handling (ARIA tabs pattern incomplete). | Roving tabindex + Left/Right/Home/End, or a `<nav>` with `aria-current`. | V, fixed `4b90792` |
| M3 | web a11y | `apps/web/index.html:6`, `src/app/Layout.tsx` | Static `<title>E-Ticket</title>`; no focus move on route change. | Per-route title; focus `h1`/`main` after navigation. | V, fixed `22b4f46` |
| M4 | gateway | `apps/gateway/src/throttling/rate-limit.ts:6`, `src/shop/payments.controller.ts:11,42` | Scopes are `orders` and `login` only; `POST /v1/payments` and cancel use the default bucket. | `payments` scope + env limit on create and cancel; polling stays default. | V |
| M5 | infra | `infra/docker-compose.yml` | No `restart:` policy on long-running services. | `restart: unless-stopped` on postgres, services, gateway, web. | V, fixed |
| M6 | infra | `infra/scripts/verify-db.sh:29` | Asserts exactly one finished migration per schema; fails on the first second migration. | Compare with the migration directory count, or `>= 1` and no unfinished rows. | V |
| M7 | contracts | `packages/contracts/package.json` (`check:generated`) | Drift check is manual; not in the root gate. `git diff` misses new untracked files. No drift today. | Add to the Phase 8 CI and `phase-gate`; also check `git status --short`. | V |

### Low

| # | Area | Location | Finding | Ver |
|---|---|---|---|---|
| L1 | payment | `apps/payment-service/src/payments/domain/request-hash.ts:5-9` | Request hash uses card `last4`, so a different PAN with the same last4/expiry/holder replays instead of 422. Documented choice (spec §4.2); a keyed HMAC of the PAN would close it. | V |
| L2 | ledger | ledger `migration.sql:97` | UPDATE/DELETE/TRUNCATE revoked on journal tables only; `ledger_app` can update `ledger.accounts` (incl. `currency`, trusted by the balance trigger). | V |
| L3 | web a11y | `apps/web/src/styles/tokens.css` | `--stamp` #d7321b is 4.28:1 on `--paper` (AA small text needs 4.5); `--tier-gold` below 3:1 as a non-text band. | R, fixed `f2918c8` |
| L4 | web | `apps/web/src/qr/QrPage.tsx:108` | `qrPayload ?? ''` renders an empty QR when the payload is missing. | V, fixed `7d7dfef` |
| L5 | web | `apps/web/src/backoffice/tabs/TransactionsTab.tsx` | IDs truncated to 8 chars; full value only in `title` (not reachable by touch/keyboard). | R |
| L6 | web | `apps/web/src/backoffice/session.ts` | JWT mirrored to sessionStorage (readable by XSS; CSP mitigates). Deliberate; not in an ADR. | R |
| L7 | payment | `payments.idempotency_keys` | No retention job or `created_at` index; stored responses grow forever. | R |
| L8 | payment | `payments.payments` | No CHECK tying status/method to `succeeded_at`, `card_last4`, `qr_payload`. | R |
| L9 | ledger, payment | `ledger.repository.ts:126-158`, `transactions.repository.ts:41-60` | OFFSET pagination + `count(*)` with page cap 1,000,000. | R |
| L10 | gateway | `apps/gateway/src/shop/*`, `backoffice.controller.ts` | Bodies relayed as `unknown`; validation happens downstream (BFF choice, not in an ADR). | R |
| L11 | nest | health controller, `prisma.service.ts`, `main.ts`, job scaffolding, axios timeout handling | Byte-identical or near-identical across services; `nest-common` candidates. | R |
| L12 | .NET | `Infrastructure/OrderExpiryJob.cs:269` | `CancellationToken.None` with no DB timeout; shutdown can wait the full 15 s. | R |
| L13 | .NET | `Infrastructure/OrdersRepository.cs` | Infrastructure returns API DTOs; Application is a pass-through (accepted for a thin port). | R |
| L14 | infra | Dockerfiles | Floating base tags (`node:26-alpine`, `postgres:18-alpine`, `dotnet 10.0`); no digests. | R, fixed |
| L15 | infra | `infra/migrate/Dockerfile:12` | `npm install prisma@ver` without a lockfile; version copied by hand. | R, fixed |
| L16 | infra | `.dockerignore` | Misses `docs/`, `*.md`, `.superpowers/`, `apps/web/.vitest`; doc edits bust `COPY . .` layers. | R |
| L17 | infra | `infra/docker-compose.yml:25-30` | Postgres healthcheck has no `timeout` / `start_period`. | R, fixed |
| L18 | infra | `infra/docker/nginx.conf` | No `Permissions-Policy`; `gzip_types` lacks `application/json`. | R, fixed |

Already tracked elsewhere and not repeated: outbox crash window (ADR-0006
amendment), ledger 4xx retried to FAILED, `Page` maximum in `common.yaml`,
throttler storage cap and per-route key, .NET expiry-job shutdown tests,
arm64 image, NuGet audit policy, deferred Phase 7 minors.

Fixed on branch `fix/web-review` (2026-11-15): M1, M2, M3, L3, L4, plus
web-review findings for root font size, route code splitting, QR live region,
cancel error text and payment method in the URL.

Fixed on branch `phase-8-ci` (2026-11-15, Phase 8): M6, M7, L16.

## Checked and clean

- **Payments**: idempotency claim, payment, transaction, outbox and stored
  response in one DB transaction; 422 on body mismatch; PAN/CVC never stored,
  logs redacted.
- **Quota**: one conditional UPDATE with CHECK backing, deterministic lock order,
  `SKIP LOCKED` expiry, in both NestJS and .NET.
- **Outbox**: `SKIP LOCKED` claim, consistent backoff, breaker, graceful shutdown.
- **Ledger**: `UNIQUE(transaction_id)`, deferred balance trigger, append-only
  journal grants.
- **Auth**: timing-safe API keys with scopes; JWT HS256 with issuer, expiry, max
  age, dummy bcrypt on unknown email, `no-store`, CORS allow-list.
- **Web security**: no `dangerouslySetInnerHTML` or inline styles, CSP
  consistent, card data never persisted.
- **Infra**: ports bound to 127.0.0.1, `${VAR:?}` secrets, per-schema owner and
  app roles, no cross-schema FKs, non-root multi-stage images with healthchecks.

## Not checked

Rendering in a real browser at small widths, screen-reader behaviour, bundle size
(no route-level code splitting), integration and contract suites, Docker builds,
line-by-line .NET ↔ NestJS parity, test coverage numbers.

## Remediation roadmap

| Order | Items | When |
|---|---|---|
| 1 | M1, M2, M3, L3, L4 (SPA error and a11y pass) | Small fix branch before Phase 8 |
| 2 | M4 (payments rate-limit scope), L2 (revoke on accounts) | Same branch, TDD |
| 3 | M6, M7, L16 (gates and build cache) | Fixed in Phase 8 |
| 4 | M5, L14, L15, L17, L18 (image and runtime hardening) | Phase 9 K3s plan |
| 5 | L1, L6, L10 (record as ADR amendments or close) | Any docs pass |
| 6 | L7–L9, L11–L13 (scale and refactor) | After the challenge, if kept |

Verification plan: each fix lands test-first where a test can express it, then
the `phase-gate` skill; SPA fixes also run the `ui-walkthrough` skill.
