# Phase-0 Zero-Context Review — E-Ticketing & Payment Simulation Platform

**Target package:** `docs/spec.md`, `docs/adr/0001–0010`, `packages/contracts/openapi/{gateway,ticket-service,payment-service,ledger-service}.yaml`, `packages/contracts/events/payment-succeeded.schema.json`, `packages/contracts/README.md`
**Judged against:** `docs/challenge.md` (requirements source of truth) and `AGENTS.md` (working agreement).
**Method:** seven independent zero-context reviewer passes (comprehension, design ×2, implementation readiness, structural, zoom-out, style), findings deduplicated and cross-verified against the artifacts by the synthesizer.

## Reviewer status

| Reviewer | Status |
| --- | --- |
| `comprehension` | completed (retried once after rate-limit cut) |
| `design` (instance A) | completed |
| `design` (instance B) | completed |
| `implementation-readiness` | completed (retried once after rate-limit cut) |
| `structural` | completed (retried once after rate-limit cut) |
| `zoom-out` | completed (retried once after rate-limit cut) |
| `style` | completed |

---

## BLOCKER

### B1. Nothing enforces at most one live payment per order — double ledger revenue with every subsystem green
**Cites:** `docs/spec.md` §3.2 (`payments` table), §4.2–4.4; `packages/contracts/openapi/payment-service.yaml` (`POST /v1/payments`); `docs/adr/0005`, `docs/adr/0009`. Found independently by design A, design B, and implementation-readiness.
**Gap:** `payments.order_id` is only indexed, never unique. The "order must be PENDING" check does not stop a second `POST /v1/payments` with a *different* `Idempotency-Key` while a first payment is PENDING (QR's 8-second window) or SUCCEEDED-but-unconfirmed (outbox lag ≥ 2 s, far longer under retry). Trace: QR payment created → user switches to card with a new key → card succeeds (transaction T1 + outbox E1) → at +8 s the scheduler flips the QR payment (T2 + E2). Ledger idempotency anchors on `UNIQUE(transaction_id)` and T1 ≠ T2, so **both** journal entries post — revenue is 2× the order total; the second order-confirm is a documented 200 no-op, so both events end DONE and no error is ever raised. This silently violates spec §1 quality goal #2 ("no lost or duplicated payments"). The idempotency table (ADR-0005) only dedupes retries of the same request and the ADR rejected `UNIQUE(order_id, method)` without putting any business-level guard in its place.
**Fix:** (1) partial unique index `UNIQUE(order_id) WHERE status IN ('PENDING','SUCCEEDED')` on `payments` (or an equivalent conditional insert in the same transaction), with a second attempt returning `409` (e.g. `ORDER_NOT_PAYABLE` or a new `PAYMENT_ALREADY_EXISTS`); (2) define how a user abandons a pending QR payment to switch methods (explicit cancel → payment `FAILED`, releasing the slot — this also makes `FAILED` reachable, see M6); (3) make the QR flip conditional (`WHERE status='PENDING'`); (4) state in ADR-0009 that `UNIQUE(transaction_id)` dedupes *deliveries*, not *payments*; (5) add this scenario to the mandatory test-first list.

### B2. The idempotency protocol is self-contradictory and incomplete — contract tests cannot be written from it
**Cites:** `docs/adr/0005` ("return the stored response **verbatim**"); `docs/spec.md` §4.2, §3.2 (`idempotency_keys.response_status`); `payment-service.yaml` `POST /v1/payments` (replay hard-coded as `200`, create `201`); `gateway.yaml` `/v1/payments`. Found by design A, design B, implementation-readiness, comprehension.
**Gap, four parts:**
(a) **Replay status contradiction.** The original create returns 201 and `response_status` is stored precisely so the replay can be verbatim — yet both contracts define replay as a distinct 200. The Phase-2 contract suite (the gate for the .NET port) cannot satisfy both documents.
(b) **Fate of the key on failure is undefined.** ADR-0005 covers only the success path. If a 422 `INVALID_CARD` / 409 `ORDER_NOT_PAYABLE` response is persisted under the key, a user who retries the *corrected* card body under the same key gets `422 IDEMPOTENCY_KEY_REUSE` forever (different hash) — a bricked checkout; if it is rolled back, the key is reusable, contradicting the key-table model. Nobody says which.
(c) **The losing concurrent request has no defined behavior.** "Loses on the PK and is treated as a replay" skips that at the moment of the PK conflict the winner's transaction is normally uncommitted, so there is no stored response to replay (READ COMMITTED cannot see it). Block on the row lock? Poll with what timeout? Return 409/425 "in progress"?
(d) **Stale-PENDING replay unstated.** A QR replay returns the stored PENDING body "verbatim" even after the payment succeeded — acceptable only because the SPA polls `GET`, but it must be stated as intended.
**Fix:** pick one semantics and align all four documents. Recommended (Stripe-style): store and replay the original status + body for outcomes that represent an attempted payment; do **not** bind keys to pre-side-effect failures (400/404/409 order-state; decide 422 INVALID_CARD explicitly); the loser blocks on the winner's commit then replays; document the stale-PENDING replay.

### B3. Order-confirm has no specified concurrency control against the expiry job — silent quota-counter corruption
**Cites:** `docs/spec.md` §4.1 (expiry job: `FOR UPDATE SKIP LOCKED`) and §4.4 step 2; `docs/adr/0004`; `ticket-service.yaml` `POST /v1/internal/orders/{orderId}/confirm`. Found by design A and implementation-readiness.
**Gap:** the expiry job's locking is specified; the confirm handler's is not. Race: confirm reads the order (sees PENDING); the expiry job concurrently marks it EXPIRED and decrements `reserved`; confirm then also executes `reserved -= qty, sold += qty`. When other orders hold reservations on the same ticket type, `reserved` stays ≥ 0, so the `CHECK` constraints do **not** fire — the confirm silently steals another order's reservation while its own `UPDATE orders … WHERE status='PENDING'` matches zero rows. `SKIP LOCKED` on the expiry side only composes if confirm also takes a blocking row lock, which is nowhere stated. This is the exact invariant (`sold + reserved <= quota` matching reality) the spec claims always holds.
**Fix:** specify in §4.4/ADR-0004: confirm opens with `SELECT … FOR UPDATE` on the order row, re-reads status under the lock, branches PENDING/EXPIRED/CONFIRMED from the locked state, and performs all counter updates in that same transaction; state the lock ordering (order row before `ticket_types` rows) and that the expiry job's `SKIP LOCKED` is what makes the two jobs composable.

---

## MAJOR

### M1. Ledger-first worker ordering records revenue for orders that may never be confirmed, in an append-only ledger with no reversal procedure
**Cites:** `docs/spec.md` §4.4 (steps 1→2 and the "Edge case" paragraph); `docs/adr/0004` ("window … negligible"), `0006`, `0009` (append-only, reversals out of scope).
**Gap:** the worker posts the journal entry before confirming the order. In the documented expired-order/quota-exhausted case the confirm 409s and the event ends FAILED — but revenue was already posted to an append-only ledger with no refund flow, no reversing-entry trigger, and "manual reconciliation" undefined. The mirror failure is also unaddressed: confirm succeeds, ledger post exhausts 10 attempts → sold ticket with no revenue recorded. The "15 min vs 8 s, practically negligible" claim is false once the worker is involved: the retry schedule (Σ min(2^n, 300) s over 10 attempts ≈ 18.5 min) plus any Ticket-Service outage turns in-flight payments into expired-confirms while the expiry job legally re-releases their quota.
**Fix:** either confirm-first (the call that can be legitimately refused goes first; the ledger post is mechanically idempotent and eventually succeeds), or keep ledger-first with a correct accounting story: credit a liability account ("Customer Payments Pending") moved to Revenue on confirm, or define the concrete reversing entry posted on terminal confirm-409 (ADR-0009 says the model allows reversals — specify when one is created). Record the chosen ordering + rationale in ADR-0006 and fix the "negligible" claim in ADR-0004.

### M2. Who builds the journal lines? Responsibility table contradicts the ledger contract
**Cites:** `docs/spec.md` §2.1 (Payment Service "never does … ledger math"; Ledger "owns chart of accounts") and §4.4 step 1 ("with `transactionId`"); `ledger-service.yaml` `PostJournalEntryRequest` (caller must supply `lines` with account codes `1100`/`4000`); `events/payment-succeeded.schema.json` (no account data).
**Gap:** the contract forces the payment-service outbox worker to compose a balanced double entry with hard-coded chart-of-accounts knowledge the spec says it must never have; spec §4.4 describes a request body that doesn't match the contract. If seeded accounts change, payment-service deploys break ledger posting (`422 UNKNOWN_ACCOUNT` → FAILED events).
**Fix:** preferably make `/v1/internal/journal-entries` semantic — accept the `payment.succeeded` payload (transactionId, amountMinor, currency, orderId, paymentReference) and let the Ledger map event type → lines; otherwise amend §2.1/ADR-0009 to state the posting template lives with the producer and the ledger only enforces balance. Rewrite §4.4 step 1 with the actual body either way.

### M3. `outbox_events.PROCESSING` is a liveness hole — no crash-recovery or reclaim rule
**Cites:** `docs/spec.md` §3.2 (status enum), §4.4 ("processes PENDING/retryable"); `docs/adr/0006`.
**Gap:** nothing says when PROCESSING is set or how it is recovered. A worker that commits PROCESSING and crashes strands the event forever — it matches neither PENDING nor FAILED selection, and the payment is never ledgered/confirmed. `FOR UPDATE SKIP LOCKED` alone already prevents double-pickup, so the status is redundant as described.
**Fix:** drop PROCESSING (claim via SKIP LOCKED, mark DONE/retry in one transaction) or define a visibility-timeout reaper (PROCESSING older than N minutes re-eligible). Say which in ADR-0006.

### M4. Multi-item reservation can deadlock — surfacing as 500, not the specified 409
**Cites:** `docs/spec.md` §4.1 step 2; `docs/adr/0004` ("the database's row lock serializes concurrent buyers").
**Gap:** order A updates GOLD then VIP; concurrent order B updates VIP then GOLD (client-supplied item order) → lock-order inversion → Postgres kills one transaction (40P01), an unhandled 500 instead of `409 QUOTA_EXCEEDED`. The ADR's serialization claim is true per row, silent on multi-row ordering.
**Fix:** one sentence in §4.1/ADR-0004: process items in deterministic order (sort by `ticketTypeCode`) before the conditional UPDATEs; optionally retry once on deadlock.

### M5. `ConfirmOrderRequest.transactionId` has nowhere to live
**Cites:** `ticket-service.yaml` `ConfirmOrderRequest` ("audit trail"); `docs/spec.md` §3.1 (`orders` has no transaction/payment column), §4.4 step 2 (never mentions the body).
**Gap:** the confirm endpoint requires `{ transactionId }` for an audit trail the schema cannot persist; the claimed order↔payment audit linkage is unimplementable as designed, weakening the challenge's "clear financial audit trail" scoring.
**Fix:** add `paid_transaction_id uuid NULL` (+ index) to `orders`, set on confirm; update §4.4 to state the body. Bonus: a *different* transactionId confirming an already-CONFIRMED order can then 409 instead of silently no-op'ing.

### M6. Dead states referenced by the contracts: `CANCELLED` orders and `FAILED` payments are unreachable
**Cites:** `docs/spec.md` §3.1 (orders CHECK), §3.2 (payments CHECK); `ticket-service.yaml` `OrderStatus` + confirm 409 description ("Order cancelled, or…"); `payment-service.yaml` `PaymentStatus`. Found by six of seven reviewers.
**Gap:** no endpoint, job or flow ever cancels an order or fails a payment (Luhn-invalid is a 422 with no stated payment row; QR always succeeds), yet the confirm endpoint documents behavior for CANCELLED. Unreachable contract states are exactly what the contract test suite cannot cover, and a fresh implementer cannot produce or test those branches.
**Fix:** either add the producing flows (order cancel endpoint — also the natural fix for B1's method-switch; FAILED row on invalid card — also B2(b)) or remove the values from enums/CHECKs and the 409 wording, or mark them "reserved, no Phase-0 flow produces them."

### M7. Internal-endpoint trust is routing-based and described inconsistently (`/internal/*` vs `/v1/internal/*`), and the API-key model is ambiguous
**Cites:** `docs/adr/0010` ("Internal-only endpoints live under `/internal/*`", "POST /auth/login"); `docs/spec.md` §2.2 ("`/v1/internal/*`"); actual contract paths `/v1/internal/...`; `ticket-service.yaml`, `ledger-service.yaml`.
**Gap:** (a) the one rule keeping confirm and journal-posting off the public edge is written two different ways — a deny-rule implemented literally from ADR-0010 (`/internal/*` prefix) would not match `/v1/internal/...`; (b) "per-service key" never says per *callee* or per caller–callee edge: as written, the gateway's ticket-service key also unlocks `POST /v1/internal/orders/{id}/confirm`, so a compromised gateway (the most exposed component) can mint tickets. The "additionally never routed" phrasing presents absence-of-a-route as defense.
**Fix:** normalize to `/v1/internal/*` in ADR-0010 and spec; define the key matrix explicitly (distinct key or key-scope for internal endpoints that the gateway does not possess) — trivial to implement and converts a soft spot into an interview talking point.

### M8. Expired-confirm prose contradicts its own formula in the money path
**Cites:** `docs/spec.md` §4.4 edge case ("retries the quota acquisition **against `sold` directly**" followed by `sold + reserved + qty <= quota`); `docs/adr/0004` ("re-acquires quota against the same condition"); `ticket-service.yaml` confirm description.
**Gap:** a reader can implement `sold + qty <= quota` from the prose, changing oversell behavior. The intended meaning (reservation already released, so on success increment `sold` directly under the same guard) is never stated in one plain sentence; the policy ("customer paid; honor it") is buried parenthetically.
**Fix:** rewrite: "Policy: a paid order is honored if quota still allows. Confirm on an EXPIRED order re-runs the same quota check (`sold + reserved + qty <= quota`) and on success increments `sold` directly (no intermediate reservation); on failure returns 409 ORDER_NOT_CONFIRMABLE and the event eventually goes FAILED (manual reconciliation)." State that multi-item re-acquisition is all-or-nothing.

### M9. Reservation-exhaustion DoS on public `POST /v1/orders` — unmitigated and unacknowledged
**Cites:** `gateway.yaml` (`POST /v1/orders`, unauthenticated, `security: []`); `docs/spec.md` §2.2, §6 (100 req/min/IP).
**Gap:** each anonymous request can reserve up to 30 tickets (3 types × qty 10) for 15 minutes against quotas of 100; within the rate budget a handful of IPs lock all 300 tickets indefinitely, re-locking each expiry cycle, at zero cost. For a "production-minded" spec this availability hole on the scarcest resource is not even recorded as a trade-off.
**Fix:** at minimum record it as an accepted limitation (guest checkout makes full mitigation impossible — say so); better, cap active PENDING orders per IP at the gateway and/or lower the per-item quantity ceiling.

### M10. Online deployment target, domain and TLS — a mandatory challenge requirement with no home
**Cites:** `docs/challenge.md` §4 (deployed **online**, free domain allowed) and §6 (live demo scored); `docs/spec.md` §8 (8 lines: K3s manifests, Traefik, no host/domain/TLS/DNS); no ADR.
**Gap:** no chosen cloud/VM, no domain plan, no TLS/cert strategy, and no feasibility check (K3s + Traefik + Postgres + 6 containers will not fit a 1 GB free-tier instance). There are ADRs for a 20-line registry and integer money, but none for the decision most likely to sink the submission. No demo script exists despite "must demonstrate working demo site."
**Fix:** decide now as ADR-0011 (e.g. a free-tier ARM VM with K3s, or single-VM docker-compose — the challenge only *prefers* K8s), including domain + TLS issuance; add a 5-minute demo script (buy → QR poll → backoffice → ledger balanced) to the plan; prefer a walking-skeleton deploy early rather than big-bang at Phases 8–9.

### M11. The only hard technology mandate (.NET) is sequenced last with no fallback trigger
**Cites:** `docs/adr/0002`; `docs/spec.md` §2.1 language note, §8; `docs/challenge.md` §3 ("C# (.NET) mandatory", names "Ticket Service Backend (C# .NET)").
**Gap:** the mandatory service is built twice, with the mandatory version landing at Phase 5 of a 3–5 day budget; ADR-0002 itself admits the NestJS ticket service becomes dead code. If the schedule slips, the item that cannot be cut is the one positioned to be cut. Every ticket-service feature (expiry job, expired-confirm policy, tests) is paid for twice.
**Fix:** either build the Ticket Service in ASP.NET Core from day one (it is what the challenge suggests) or add an explicit scope guard to ADR-0002: a hard checkpoint (e.g. end of day 2) after which the port starts regardless of NestJS polish, with a pre-agreed cut list that never includes the .NET service; alternatively consider the Ledger (smallest service, no schedulers) as the native .NET service with no port at all.

### M12. Mandatory README deliverables (challenge §5) are unowned
**Cites:** `docs/challenge.md` §5 (architecture diagram, service responsibilities, run locally, deploy, env vars, API examples, assumptions & trade-offs — "Mandatory"); `docs/spec.md` (no documentation section or phase assignment).
**Fix:** add a "Deliverable documentation" subsection to spec.md mapping each §5 bullet to its source (spec sections, `.env.example` files, contracts) and assign it to a phase.

### M13. The SPA is one table row; nearly every frontend decision is open
**Cites:** `docs/spec.md` §2.1 ("Shop, checkout, payment result (poll), backoffice UI"), §4.2, §5 ("the SPA switches on `code`"); `docs/challenge.md` §2 (ticket selection with calculated total, checkout page with exactly 2 methods, "Clean UX").
**Gap:** no route map, no poll interval or give-up timeout for `GET /v1/payments/{id}` (what UI after 60 s of PENDING?), no 15-minute expiry countdown/expired-order UX, no consolidated error-code→UI mapping (13 codes scattered across four contracts), no client Idempotency-Key lifecycle (who generates, when reused vs regenerated — interacts with B2), no JWT storage choice, no serving story for the built SPA in compose/K3s. The checkout page offering exactly two methods — an explicit functional requirement — appears in no design document.
**Fix:** add a "Web app" section: routes, per-page API calls, poll cadence/timeout, countdown behavior, error-code table, key lifecycle, JWT storage, serving/ingress.

### M14. `payment_reference` generation and collision policy undefined — a UNIQUE violation aborts the critical transaction
**Cites:** `docs/spec.md` §3.2 (`payment_reference text UNIQUE -- e.g. 'PAY-20261113-7F3K9Q'`), §4.3; `payment-service.yaml` `Transaction.paymentReference`.
**Gap:** only an example exists — no charset/length/date-semantics/randomness source, and no collision handling even though a UNIQUE violation would abort the atomic success+transaction+outbox write. Retry loop? How many attempts? What error if exhausted?
**Fix:** specify the format (e.g. `PAY-<UTC yyyymmdd>-<6 chars Crockford base32, crypto-random>`) and the retry-on-collision rule.

### M15. "sha256 of canonical request body" — canonicalization never defined
**Cites:** `docs/spec.md` §3.2 (`request_hash`), §7 (mandated "idempotency hash" unit tests); `docs/adr/0005`.
**Gap:** raw bytes vs re-serialized JSON, key ordering, whitespace, before/after `whitelist + forbidNonWhitelisted` stripping, and whether the PAN participates in the hash input (a PCI-adjacent choice given ADR-0010) are all open; the replay-vs-422 outcome differs by choice, and the mandated unit tests cannot be written.
**Fix:** define it (recommend: stable-stringify of the validated, whitelisted DTO; document PAN inclusion/exclusion).

### M16. The configuration surface is undefined — every `.env.example` is currently an invention
**Cites:** `docs/spec.md` §2.2/§6; `docs/adr/0010`; `docs/challenge.md` §5 (env vars must be documented).
**Gap:** documented names: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `CONTRACT_BASE_URL` only. Missing: JWT secret name; per-service API-key names *and the key model* (per callee vs per caller–callee edge — see M7); DB URLs per service plus the separate migration-role URL implied by §3.3; downstream base URLs (gateway→3, payment→2); ports; CORS origin; SPA gateway URL; throttle settings.
**Fix:** add an env-var table per service to spec §6 (it also directly feeds the mandatory README).

### M17. Migration/bootstrap/role choreography undefined
**Cites:** `docs/spec.md` §3.3 ("migrations run as a separate role"), §8; `docs/adr/0003`, `0009`; `AGENTS.md` (Prisma raw-SQL migrations).
**Gap:** who creates the three schemas/users/migration roles (compose init SQL? bootstrap script?); how Prisma runs under a migration role while runtime uses the restricted user; the GRANT/REVOKE script for append-only; the DDL sketch for the deferred constraint trigger enforcing Σdebits=Σcredits; migrations on K3s (Job? init container?); and migration ownership after the .NET port (Prisma reused or EF Core adopted for the `tickets` schema — ADR-0002 is silent).
**Fix:** one subsection in spec §8 + a line in ADR-0002 deciding post-port migration ownership.

### M18. Gateway failure modes undefined, and the gateway contract is lax where it claims to mirror
**Cites:** `gateway.yaml` (`DownstreamError` "passed through"; no 5xx responses anywhere; description "Shapes mirror the downstream contracts"; list wrappers omit every `required` array the service files declare); `docs/spec.md` §2.1/§5; service contracts (`payment-service.yaml` line ~114, `ledger-service.yaml` ~73, `ticket-service.yaml` ~36); `packages/contracts/README.md` anti-drift rule.
**Gap:** (a) nothing defines what the gateway returns on downstream timeout/connection-refused (502/503/504, with what stable `code`), its timeout values, or whether pass-through is byte-for-byte; (b) gateway response wrappers omit `required`, so contract tests would accept responses missing `data` and generated SPA types go all-optional — contradicting the mirror claim; (c) shared components (Error, Health, CorrelationId, Page/PageSize, ApiKey) are copy-pasted 3–4× with drift already visible (payment-service lacks the `ValidationError` component the other two define). The gateway also never declares the `X-Correlation-Id` parameter that spec §2.2 says every request carries.
**Fix:** define the downstream-failure envelope + timeouts; add the `required` arrays; either extract a shared `common.yaml` (Redocly bundles multi-file fine) or state the intentional-duplication rule and fix the asymmetries; add the correlation-id parameter to gateway.yaml.

### M19. Spec has no consolidated Risks & Mitigations section
**Cites:** `docs/spec.md` (whole document); risk content scattered in §4.4, ADR-0003/0004/0006 trade-offs.
**Gap:** the feature-spec standard requires explicit failure modes/security/scale limits; a reader must reconstruct the risk picture from ten ADR trade-off paragraphs. Duplicate-payment, FAILED-event reconciliation, at-least-once delivery, shared Postgres, static keys/no JWT revocation, quota-counter lag, DoS (M9) belong in one place.
**Fix:** add a top-level "Risks & mitigations" section to spec.md; while there, state spec-vs-ADR precedence (today each decision exists in two full copies with no declared owner — they will fork).

---

## MINOR

1. **Login path and response drift.** `/auth/login` (spec §2.2, §6; ADR-0010) vs `/v1/auth/login` (spec §4.5; `gateway.yaml`); response "`{ accessToken }`" (spec §4.5) vs required `{ accessToken, expiresIn }` (gateway.yaml). Normalize to `/v1/auth/login` and the full shape everywhere.
2. **Phase numbers are load-bearing but unresolvable.** "Phase 1/2/3/5/8" appear across `spec.md`, ADR-0002/0008, `contracts/README.md`; the plan lives only in `docs/PROMPT.md`, linked from none of them. Link PROMPT.md from the spec header and contracts README.
3. **Per-item quantity cap exists only in the contract.** `ticket-service.yaml` `CreateOrderRequest` `maximum: 10` vs spec §4.1/AGENTS.md (no cap). State the business rule in §4.1 and decide whether it needs a DB CHECK.
4. **Card expiry validation undecided and `expYear: minimum 2024` is already in the past.** `payment-service.yaml` `CardDetails`; spec §4.2 is Luhn-only. Decide: expired cards rejected (code?) or explicitly ignored in the simulation; fix the minimum.
5. **Duplicate `ticketTypeCode` entries in `items` → deterministic 500.** `CreateOrderRequest` permits them; `UNIQUE(order_id, ticket_type_id)` (spec §3.1) aborts the insert. Decide merge-quantities vs `400 VALIDATION_ERROR`; both stacks and the contract tests need one answer.
6. **QR flip job concurrency discipline unspecified.** Spec §4.2: the 1-second scheduler has no conditional-update/`SKIP LOCKED` wording and no multi-replica note (the other two jobs do). `UNIQUE(payment_id)` on `transactions` is the implicit backstop — say so, and state that all three schedulers assume replicas=1 (the §1 "stateless services" non-goal doesn't cover them).
7. **`GET /v1/accounts` is an orphan endpoint.** `ledger-service.yaml`; no gateway route or spec flow consumes it. Wire it into the backoffice — account balances are the single best live-demo proof the ledger balances — or mark it ops-only.
8. **"Manual replay" of FAILED outbox events has no mechanism.** Spec §4.4/ADR-0006. Add a one-line SQL runbook (`UPDATE … SET status='PENDING', attempts=0 …`) or a backoffice listing of FAILED events.
9. **Ledger replay ignores payload mismatch.** `ledger-service.yaml`/ADR-0009 return 200 with the existing entry even if the incoming lines differ — a worker bug is silently swallowed. Compare lines and 409/422 on mismatch (mirror the request-hash pattern).
10. **No currency-uniformity rule for journal entries.** `JournalLineInput` carries per-line currency; nothing requires one currency per entry or line-currency = account-currency, without which Σdebits=Σcredits is numerically meaningless. One sentence in §3.3/ADR-0009.
11. **Traceability table missing.** No challenge-requirement → spec/ADR/contract mapping exists; coverage is in fact complete (verified) but must be rebuilt by hand each review, and deliberate interpretations — notably challenge "Payment result: Always success" vs the spec's 422 on Luhn-invalid — are nowhere recorded as deviations. Add the table with an interpretations column.
12. **Three non-obvious decisions lack the ADRs AGENTS.md mandates.** (a) introducing a Gateway/BFF at all (not in the challenge's topology); (b) contract-first hand-written OpenAPI 3.0.3 (rationale lives only in `contracts/README.md`, outside the ADR system); (c) SPA polling vs SSE/WebSocket for QR completion. Add ADR-0011..0013 and extend the §9 index.
13. **Correlation-ID rules incomplete.** Behavior on a non-UUID/overlong client value (accept/replace/truncate) unstated; `PostJournalEntryRequest` carries `correlationId` in both header and body with no precedence; gateway.yaml omits the header entirely (see M18).
14. **`PaymentHandler` result shape is an acknowledged open design.** ADR-0008 defers the sync/async unified result shape to Phase 3; it must be pinned before the .NET port replicates it. Record the interface (ctx contents; immediate-success vs pending+payload; where `card_last4`/`qr_payload`/`succeed_after` come from).
15. **Gateway scope discipline.** The BFF has accreted "routing/aggregation" language and per-route throttling; the defensible core is dumb proxy + key custody + JWT login. State that explicitly (and see M18); a Traefik-level alternative deserves one ADR line.
16. **Alternatives are invisible from the spec itself.** §9 lists only chosen decisions; add a one-line "rejected alternatives" column so a spec-only reader sees evaluation happened (content already exists in the ADRs).

---

## NIT

1. Path-parameter notation drift: mermaid uses `:id` (spec §2), prose uses `{id}`, contracts use `{orderId}`/`{paymentId}`; `payment-service.yaml`'s own description says "GET /v1/payments/{id}" while the path is `{paymentId}`. Standardize.
2. "Ledger entries" (gateway, spec §4.5) vs "journal entries" (ledger service, schemas) — same resource; add a one-line alias note or rename.
3. "Transaction" overloaded: §4.3's heading "the critical transaction" and ADR-0006 mix DB transactions with the `transactions` business record. Rephrase to "one atomic DB transaction."
4. Outbox guarantee phrasing (spec §4.3): "a crash can never produce a paid order with no ledger entry *recorded as intent*" first over-promises then hedges. Rewrite: after any crash, every paid order has at least a pending outbox event; delivery happens when the worker runs.
5. Uncalibrated claims to soften for interview credibility: "textbook minimal form" (ADR-0004), "real isolation"/"migration path is mechanical" (ADR-0003), "absurd overhead" (ADR-0008), "PCI-shaped trouble by construction" (ADR-0010), "(where it belongs)" (ADR-0006), present-tense "the contract test suite proves the port" (spec §2.1, ADR-0002 — the suite doesn't exist yet; say "gates").
6. `correlationId` reads as required in the spec §4.3 payload list but is optional in `payment-succeeded.schema.json`; mark "(optional)" in the spec. Also link the schema file from §4.3 instead of duplicating the field list.
7. Account balance derivation defined only for ASSET/REVENUE while `AccountType` has five values (`ledger-service.yaml` `/v1/accounts` description). Add the debit-normal/credit-normal rule or note only two types are seeded.
8. `Transaction` schema leaves `orderId`/`amountMinor`/`currency`/`method` optional though the backoffice needs them and they are always derivable from the payments join (which is itself undocumented — the `transactions` table doesn't store them). Mark required + "denormalized from the payment."
9. 429 declared on some gateway routes but not `GET /v1/orders/{id}`, `GET /v1/payments/{id}`, or any backoffice route, despite the global 100 req/min/IP limit (spec §6). Declare uniformly. Related: no stated polling budget — 1 Hz payment polling plus shop traffic approaches the limit.
10. "Swagger UI at `/docs` (non-production only for internal services)" (spec §5) — which services are "internal" is not stated; spell out both cases.
11. Error envelope "on every non-2xx" (spec §5) is contradicted by `/health/ready` 503 returning the Health schema; add "health exempt." `correlationId` is optional in all four Error schemas though the gateway always generates one — consider requiring it.
12. `outbox_events.processed_at` (spec §3.2) is never referenced by any flow; state it is set on DONE/FAILED or drop it. Zoom-out note: since both downstream calls are idempotent, the per-action completion columns + PROCESSING are a micro-optimization — PENDING/DONE/FAILED with both calls replayed would be simpler (optional simplification; AGENTS.md does not mandate the columns).
13. JWT claims (sub/iss/aud/exp only?) and bcrypt cost factor unspecified (spec §2.2/§4.5, ADR-0010).
14. Journal `description` template undefined — the example truncates a UUID ('Ticket sale, order 6a1f0e9e'); pin the format.
15. Unpinned operational numbers: expiry-job batch cap, worker intra-batch concurrency, HTTP timeouts (worker→ledger/ticket, payment→ticket), Postgres version/image, DB names. Also label the cadences in §4 (60 s / 1 s / 2 s / redact paths) as defaults rather than contract, so the .NET port isn't bound to them.
16. Stored idempotent replays carry the original request's `correlationId` in the body — acceptable, but say so (spec §3.2).
17. `docs/PROMPT.md` line 1 references `docs/challenge.pdf`; the repo has only `challenge.md`. Fix the pointer. Also delete the leftover `docs/adr/.gitkeep`.
18. QR payload `eticket:pay:{paymentId}` is not a UPI/QRIS format (challenge names them); fine for a simulation — one sentence of acknowledgment avoids the interview nitpick.
19. The event JSON Schema is ceremony for a payload that never leaves the service as an event (the worker translates it into two REST calls); it's already written — just don't invest further (validation wiring/codegen).
20. Scope/cut-line notes: backoffice is "optional but valued" in the challenge but treated as unconditional — mark it the designated cut if days 4–5 evaporate; the 4-layer test pyramid ×2 stacks exceeds what is scored — keep the AGENTS.md-mandated test-first surfaces and the ticket-service contract suite lean, and consider running contract tests against the compose stack instead of a dedicated Testcontainers layer (advisory; AGENTS.md lists the tools).
21. Writing polish: "the confirm returns" → "the confirmation call returns" (spec §4.4, ADR-0004); fragment "both layers because money" (ADR-0009); "an operational judgment call" names no decision (spec §4.4); "are additionally never routed … to the public" → "the gateway never exposes /v1/internal/* publicly" (spec §2.2); gateway.yaml "See ticket-service.yaml TicketType" is a pointer, not a description.

---

## Coverage confirmation

Verified as having a home (no finding): challenge §2 ticket types/prices/quotas (spec §3.1, seed), two payment methods + Luhn + 8 s QR server-side success (spec §4.2, ADR-0008), transaction ID/reference/timestamp (spec §4.3), double-entry ledger with example accounts (spec §3.3, ADR-0009), backoffice views (spec §4.5); challenge §3 microservices/REST, Postgres schema separation + constraints/indexes (spec §3, ADR-0003), API-key auth + validation + idempotency + no committed secrets (spec §2.2/§5, ADR-0005/0010), payment modularity (ADR-0008); challenge §4 CI minimum and bonus items (spec §8); AGENTS.md functional rules (atomic conditional UPDATE, 15-min expiry job, server-side amounts, outbox atomicity, `UNIQUE(transaction_id)`, minor units, correlation IDs, health, Swagger). Requirements with **no** home are captured above as M10 (online deployment/domain/TLS), M12 (README ownership), M13 (checkout/SPA flow), MINOR-14/AGENTS layering rule (controller/application/domain/repository — one line or short ADR needed), and the dead CANCELLED state (M6).

---

## Overall verdict

This is an unusually strong Phase-0 package: the chosen patterns (conditional-UPDATE reservation, Stripe-style idempotency table, transactional outbox, `UNIQUE(transaction_id)` double-entry ledger, schema-per-service) are the right ones, the ADRs genuinely argue alternatives, and spec/contracts/event-schema agree on far more than they disagree. It is nevertheless **not approvable as-is**: three blockers sit squarely in the money path — nothing enforces one live payment per order (double revenue with every subsystem reporting success), the idempotency protocol contradicts its own contracts and leaves its failure/concurrency semantics to the implementer, and the confirm/expiry race has no specified locking — and the majors cluster around an accounting ordering the append-only ledger cannot absorb, a responsibility boundary the ledger contract violates, and three challenge-mandatory items (online deployment, README, .NET sequencing) that currently have no design or no slack. All of it is fixable with spec/ADR/contract edits before Phase 1; none of it requires architectural rework. Fix the three blockers and M1–M8 before declaring the contracts "source of truth," and decide M10/M11 before any further NestJS investment.

---

## Resolution log (spec revision 2)

| Finding | Resolution |
| --- | --- |
| B1 one live payment per order | Partial unique index `payments(order_id) WHERE status IN ('PENDING','SUCCEEDED')`; `409 PAYMENT_IN_PROGRESS` / `ORDER_ALREADY_PAID`; cancel endpoint; ADR-0009 states transaction_id dedupes deliveries, not payments (spec §3.2, §4.2) |
| B2 idempotency semantics | Bind-on-create; 4xx leaves key free; blocking `INSERT … ON CONFLICT`; replay = stored 201 + `Idempotent-Replayed`; stale QR replay documented (ADR-0005, spec §4.2, payment contract) |
| B3 confirm vs expiry race | Confirm takes blocking `FOR UPDATE` on order row; fixed lock order (spec §4.5, ADR-0004) |
| M1 ledger-first ordering | Confirm first; `UNFULFILLED_PAYMENT` → 2100 Customer Refunds Payable; "negligible" claim replaced (ADR-0004/0006/0009) |
| M2 who builds journal lines | Semantic `POST /v1/internal/postings`; ledger owns templates (ADR-0009, ledger contract) |
| M3 PROCESSING liveness | Removed; row lock per event is the claim (ADR-0006) |
| M4 deadlock | Items sorted by code (spec §4.1) |
| M5 transactionId storage | `orders.paid_transaction_id` UNIQUE; different tx on CONFIRMED → 409 |
| M6 dead states | Order CANCELLED and payment FAILED removed; payment CANCELLED now reachable via cancel |
| M7 key scope | Public vs internal scope keys; paths normalized to `/v1/internal/*` (ADR-0010, spec §2.2) |
| M8 expired-confirm prose | Rewritten as explicit policy (spec §4.5, ADR-0004) |
| M9 reservation DoS | 5 orders/min/IP + recorded limitation (spec §7, §10) |
| M10 deployment | ADR-0011 (Oracle A1 + K3s + Traefik/Let's Encrypt + DuckDNS), early skeleton deploy |
| M11 .NET sequencing | Hard start date + cut list in ADR-0002 |
| M12 README | Spec §12 |
| M13 SPA | Spec §5 |
| M14 payment reference | Format + retry rule (spec §4.3) |
| M15 hash canonicalization | Spec §4.2, ADR-0005; PAN excluded |
| M16 env vars | Spec §7.1 |
| M17 migrations/roles | Spec §9, ADR-0002/0003 |
| M18 gateway failures/drift | 502/504 envelope, `required` arrays, `common.yaml`, correlation header on every route |
| M19 risks | Spec §10; precedence rule in spec header |
| Minors | All addressed except: #15 handled by ADR-0012; #16 via decision-index column |
| Nits | Addressed in rewrite; #19 (event schema) kept but marked non-message |
