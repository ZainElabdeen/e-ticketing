# E-Ticketing & Payment Simulation Platform — System Specification

Status: Phase 0, revision 2 (after the zero-context review in
[review/phase0-zero-context-review.md](./review/phase0-zero-context-review.md)).

- Requirements source of truth: [challenge.md](./challenge.md).
- Working rules: [../AGENTS.md](../AGENTS.md). Phase plan: [PROMPT.md](./PROMPT.md).
- Decisions and their alternatives: [adr/](./adr/). API contracts:
  [../packages/contracts/](../packages/contracts/).

**Precedence.** This spec states *what* the system does. ADRs state *why*.
OpenAPI contracts state the exact wire shapes. If they disagree, the contract
wins for wire shapes and the spec wins for behavior; the disagreement is a bug
to fix in the same change.

## 1. Overview

A microservices platform that sells event tickets, simulates payments (card and
QR), records every successful payment as a double-entry ledger journal, and
exposes a backoffice for transactions, ledger entries, account balances and
ticket availability.

Quality goals, in order:

1. **Explainable**: every schema, flow and decision can be defended in an
   interview. ADRs record the why.
2. **Correct money handling**: at most one successful payment per order, no
   lost or duplicated ledger postings, every journal entry balanced, full audit
   trail from ticket to ledger line.
3. **Production-minded**: health checks, structured logs, correlation IDs,
   idempotency, CI/CD, containerized deploy to K3s on a public URL.

Non-goals: real payment gateways, refunds and payouts, multi-currency, shopper
accounts, horizontal scaling of the scheduled jobs (see §10).

## 2. Architecture

```mermaid
flowchart LR
    SPA[React SPA<br/>apps/web] -->|HTTPS| GW[Gateway BFF<br/>apps/gateway :3000]
    GW -->|REST, public-scope key| TS[Ticket Service<br/>.NET after Phase 5 :3001]
    GW -->|REST, public-scope key| PS[Payment Service<br/>apps/payment-service :3002]
    GW -->|REST, public-scope key| LS[Ledger Service<br/>apps/ledger-service :3003]
    PS -->|GET /v1/orders/{orderId}| TS
    PS -->|outbox worker<br/>POST /v1/internal/orders/{orderId}/confirm<br/>internal-scope key| TS
    PS -->|outbox worker<br/>POST /v1/internal/postings<br/>internal-scope key| LS
    TS --- DB1[(PostgreSQL<br/>schema tickets)]
    PS --- DB2[(PostgreSQL<br/>schema payments)]
    LS --- DB3[(PostgreSQL<br/>schema ledger)]
```

One PostgreSQL instance; one schema, one owner role and one runtime role per
service. No cross-schema foreign keys; services integrate only over REST
(ADR-0003).

### 2.1 Service responsibilities

| Service | Owns | Never does |
| --- | --- | --- |
| **Gateway** (NestJS BFF) | Public edge: CORS, rate limits, backoffice login and JWT checks, correlation-ID issuance, key custody, proxying to services | Business logic, database access, holding internal-scope keys |
| **Ticket Service** (NestJS reference, then ASP.NET Core) | Ticket types, quota, orders, atomic reservation, order expiry, order confirmation | Payments, money movement |
| **Payment Service** (NestJS) | Payment methods (Strategy), idempotency, one-live-payment-per-order rule, transactions, outbox delivery | Pricing (amount always read from the Ticket Service), choosing ledger accounts |
| **Ledger Service** (NestJS) | Chart of accounts, posting templates, double-entry journal, append-only audit trail, balances | Knowing about tickets or payment methods |
| **Web** (React SPA) | Ticket selection, checkout, payment result, backoffice UI | Holding API keys, computing prices |

Language note: the challenge mandates C#/.NET for at least one core service and
names the Ticket Service as the .NET candidate. We build the Ticket Service in
NestJS first, then port it to ASP.NET Core against the same contract, gated by
the same black-box contract suite, with a hard start date for the port
(ADR-0002). Payment (Node) matches the challenge's suggestion. Ledger is
NestJS where the challenge says "Python or similar" (ADR-0002).

Every NestJS service uses the layers controller → application service →
domain → repository; the .NET port mirrors them (controller → application →
domain → EF Core repository).

### 2.2 Communication and trust (ADR-0010)

- The SPA talks only to the gateway. The browser never holds an API key.
- Every service endpoint except health probes requires `X-Api-Key`.
- Keys are scoped:
  - **public scope** — held by the gateway; accepted on `/v1/*` routes except
    `/v1/internal/*`.
  - **internal scope** — held only by the Payment Service; required on
    `/v1/internal/*` and also accepted on the public routes it calls
    (`GET /v1/orders/{orderId}`). The gateway does not possess it, so a
    compromised gateway cannot confirm orders or post to the ledger.
- The gateway never exposes `/v1/internal/*` (no route), and the services
  reject public-scope keys there (authorization, not just routing).
- Backoffice routes on the gateway require a JWT from `POST /v1/auth/login`.
- Correlation: the gateway accepts a client `X-Correlation-Id` if it is a UUID,
  otherwise generates a UUID v4. Every service logs it, returns it in error
  bodies, and forwards it on outbound calls, including outbox-worker calls (the
  ID is stored on the outbox event).

## 3. Data model

Money is stored as `bigint` **minor units** (fils; 1 AED = 100 fils) with a
`currency char(3)` column wherever an amount appears (ADR-0007). Primary keys
are UUID v4 generated by the service. Timestamps are `timestamptz`, UTC.
Constraint and index names are fixed in the Phase 1 migrations.

### 3.1 Schema `tickets` (owner: Ticket Service)

```text
ticket_types
  id            uuid PK
  code          text UNIQUE NOT NULL        -- 'GOLD' | 'PREMIUM' | 'VIP'
  name          text NOT NULL
  price_minor   bigint NOT NULL CHECK (price_minor > 0)
  currency      char(3) NOT NULL DEFAULT 'AED'
  quota         int NOT NULL CHECK (quota >= 0)
  sold          int NOT NULL DEFAULT 0 CHECK (sold >= 0)
  reserved      int NOT NULL DEFAULT 0 CHECK (reserved >= 0)
  CHECK (sold + reserved <= quota)

orders
  id                   uuid PK
  status               text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','EXPIRED'))
  total_minor          bigint NOT NULL CHECK (total_minor > 0)
  currency             char(3) NOT NULL DEFAULT 'AED'
  created_at           timestamptz NOT NULL DEFAULT now()
  expires_at           timestamptz NOT NULL
  confirmed_at         timestamptz NULL
  paid_transaction_id  uuid NULL            -- payment transaction that confirmed it (logical ref)
  CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL AND paid_transaction_id IS NOT NULL))
  INDEX (status, expires_at), INDEX (created_at), UNIQUE (paid_transaction_id)

order_items
  id                uuid PK
  order_id          uuid NOT NULL FK -> orders(id)
  ticket_type_id    uuid NOT NULL FK -> ticket_types(id)
  quantity          int NOT NULL CHECK (quantity BETWEEN 1 AND 10)
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor > 0)
  line_total_minor  bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity)
  UNIQUE (order_id, ticket_type_id)
  INDEX (order_id)
```

Seeded by migration: Gold 10000, Premium 20000, VIP 50000 (minor units, AED);
quota 100 each.

### 3.2 Schema `payments` (owner: Payment Service)

```text
payments
  id             uuid PK
  order_id       uuid NOT NULL               -- logical ref, no cross-schema FK
  method         text NOT NULL CHECK (method IN ('CARD','QR'))
  status         text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','CANCELLED'))
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0)
  currency       char(3) NOT NULL DEFAULT 'AED'
  card_last4     char(4) NULL                -- never the full PAN (ADR-0010)
  qr_payload     text NULL
  succeed_after  timestamptz NULL            -- QR only: created_at + 8 s
  created_at     timestamptz NOT NULL DEFAULT now()
  succeeded_at   timestamptz NULL
  cancelled_at   timestamptz NULL
  UNIQUE (order_id) WHERE status IN ('PENDING','SUCCEEDED')   -- one live payment per order
  INDEX (status, succeed_after), INDEX (order_id), INDEX (created_at)

transactions
  id                 uuid PK                -- the public "Transaction ID"
  payment_id         uuid NOT NULL UNIQUE FK -> payments(id)
  payment_reference  text NOT NULL UNIQUE   -- see §4.3
  created_at         timestamptz NOT NULL DEFAULT now()
  INDEX (created_at)

idempotency_keys
  key              text PK                  -- Idempotency-Key header, 8..128 chars
  request_hash     char(64) NOT NULL        -- see §4.2
  payment_id       uuid NULL FK -> payments(id)
  response_status  int NULL                 -- NULL only inside the creating DB transaction
  response_body    jsonb NULL
  created_at       timestamptz NOT NULL DEFAULT now()

outbox_events
  id               uuid PK
  type             text NOT NULL            -- 'payment.succeeded'
  payload          jsonb NOT NULL           -- events/payment-succeeded.schema.json
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED'))
  confirm_outcome  text NULL CHECK (confirm_outcome IN ('CONFIRMED','NOT_CONFIRMABLE'))
  attempts         int NOT NULL DEFAULT 0
  next_attempt_at  timestamptz NOT NULL DEFAULT now()
  last_error       text NULL
  created_at       timestamptz NOT NULL DEFAULT now()
  processed_at     timestamptz NULL         -- set when status becomes DONE or FAILED
  INDEX (status, next_attempt_at)
```

`transactions` stores only the identity of the success; amount, currency,
method and order come from the joined `payments` row. Backoffice responses
denormalize them.

### 3.3 Schema `ledger` (owner: Ledger Service)

```text
accounts
  id        uuid PK
  code      text UNIQUE NOT NULL
  name      text NOT NULL
  type      text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'))
  currency  char(3) NOT NULL DEFAULT 'AED'

journal_entries
  id                 uuid PK
  transaction_id     uuid NOT NULL UNIQUE   -- idempotency anchor: one entry per payment transaction
  posting_type       text NOT NULL CHECK (posting_type IN ('TICKET_SALE','UNFULFILLED_PAYMENT'))
  payment_reference  text NOT NULL
  order_id           uuid NOT NULL
  description        text NOT NULL          -- 'Ticket sale PAY-… order <uuid>'
  currency           char(3) NOT NULL
  correlation_id     text NULL
  posted_at          timestamptz NOT NULL DEFAULT now()
  INDEX (posted_at)

journal_lines
  id                uuid PK
  journal_entry_id  uuid NOT NULL FK -> journal_entries(id)
  account_id        uuid NOT NULL FK -> accounts(id)
  direction         text NOT NULL CHECK (direction IN ('DEBIT','CREDIT'))
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0)
  INDEX (journal_entry_id), INDEX (account_id)
```

Seeded chart of accounts:

| Code | Name | Type | Normal side |
| --- | --- | --- | --- |
| 1100 | Payment Gateway Clearing | ASSET | debit |
| 2100 | Customer Refunds Payable | LIABILITY | credit |
| 4000 | Ticket Sales Revenue | REVENUE | credit |

Posting templates (owned by the Ledger, ADR-0009):

| Posting type | When | Debit | Credit |
| --- | --- | --- | --- |
| `TICKET_SALE` | order confirmed | 1100 | 4000 |
| `UNFULFILLED_PAYMENT` | paid, but the order can no longer be confirmed | 1100 | 2100 |

Invariants (ADR-0009):

- **Balanced**: per entry, Σ debit = Σ credit, enforced in the application
  inside the insert transaction and by a `DEFERRABLE INITIALLY DEFERRED`
  constraint trigger on `journal_lines`.
- **One currency per entry**: lines carry no currency of their own; the entry
  currency must equal each line's account currency.
- **Append-only**: the ledger runtime role has `SELECT, INSERT` only on the
  journal tables; `UPDATE`/`DELETE` are revoked. Corrections would be new
  reversing entries (no flow needs one today).
- **Idempotent**: re-posting a `transaction_id` with the same posting type and
  amount returns the existing entry (200); with different values returns
  `409 POSTING_CONFLICT` — a producer bug must not be swallowed.
- **Balances** are derived: debit-normal accounts (ASSET, EXPENSE) = Σdebit −
  Σcredit; credit-normal accounts (LIABILITY, EQUITY, REVENUE) = Σcredit −
  Σdebit.

## 4. Core flows

Cadences and batch sizes below are defaults (env-configurable), not contract.
All scheduled jobs assume one replica per service (§10).

### 4.1 Order creation and quota reservation (ADR-0004)

`POST /v1/orders`, body `{ items: [{ ticketTypeCode, quantity }] }`;
1–3 items, quantity 1–10, each `ticketTypeCode` at most once (duplicates →
`400 VALIDATION_ERROR`). The client never sends prices.

In one DB transaction:

1. Sort items by `ticketTypeCode`. Fixed lock order prevents deadlocks between
   concurrent multi-item orders.
2. For each item, one **atomic conditional UPDATE**:

   ```sql
   UPDATE tickets.ticket_types
      SET reserved = reserved + $qty
    WHERE code = $code AND sold + reserved + $qty <= quota
   RETURNING id, price_minor, currency;
   ```

   Zero rows → roll back everything → `409 QUOTA_EXCEEDED`.
3. Insert the order (`PENDING`, `expires_at = now() + 15 min`) and items with
   the returned unit prices; compute `total_minor` server-side.
4. Respond `201` with the order (id, status, items, total, currency,
   `expiresAt`).

**Expiry job** (every 60 s, batch ≤ 100): per order, one DB transaction:
`SELECT … FROM orders WHERE status = 'PENDING' AND expires_at < now() FOR
UPDATE SKIP LOCKED LIMIT 1`, set `EXPIRED`, then decrement `reserved` per item
in `ticketTypeCode` order.

### 4.2 Payment initiation and idempotency (ADR-0005, ADR-0008)

`POST /v1/payments`, header `Idempotency-Key` (8–128 chars, required, else
`400`), body `{ orderId, method: 'CARD'|'QR', card? }`. `card` is required for
`CARD` and forbidden for `QR`.

**Request hash.** SHA-256 hex of the canonical JSON (keys sorted, no
whitespace) of the validated DTO with the PAN and CVC replaced by the card's
last four digits: `{ orderId, method, card?: { last4, expMonth, expYear, holder } }`.
The full PAN never enters the hash input.

**Steps:**

1. Validate the body (400 on failure). Luhn-check the PAN and check the expiry
   is not before the current month; failure → `422 INVALID_CARD`.
2. Read the order from the Ticket Service: `GET /v1/orders/{orderId}`. Not
   found → `404 ORDER_NOT_FOUND`. Not `PENDING` or `expiresAt <= now()` →
   `409 ORDER_NOT_PAYABLE`. The amount is the order's `totalMinor` — **never
   client-supplied**.
3. Open a DB transaction and `INSERT INTO idempotency_keys (key, request_hash)
   … ON CONFLICT (key) DO NOTHING`. If another transaction holds the same key
   uncommitted, Postgres blocks this insert until that transaction ends; no
   polling needed.
   - Inserted → continue (we own the key).
   - Conflict → read the stored row. Same hash → **replay**: return the stored
     `response_status` (201) and body with header `Idempotent-Replayed: true`.
     Different hash → `422 IDEMPOTENCY_KEY_REUSE`.
4. Insert the payment. The partial unique index enforces one live payment per
   order: a violation rolls back → `409 PAYMENT_IN_PROGRESS` (a `PENDING`
   payment exists) or `409 ORDER_ALREADY_PAID` (a `SUCCEEDED` one exists).
5. Run the method handler (Strategy):
   - **CARD**: immediate success → run §4.3 in this same DB transaction.
     Persist only `card_last4`.
   - **QR**: `status = PENDING`, `succeed_after = now() + 8 s`,
     `qr_payload = 'eticket:pay:{paymentId}'` (a simulation format, not UPI or
     QRIS).
6. Store `payment_id`, `response_status = 201` and the response body on the key
   row; commit; respond `201`.

**Key binding rule.** A key is bound only when a payment row is created (step
6). Any failure before that (400, 404, 409, 422 `INVALID_CARD`) rolls back, so
the client may retry the same key with a corrected body. Replays of a QR
payment return the original `PENDING` body even after it succeeded; clients
read live status from `GET /v1/payments/{paymentId}`.

**Cancel (switch method).** `POST /v1/payments/{paymentId}/cancel`: `UPDATE …
SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING'`. One row →
`200`, frees the order for a new payment. Zero rows → `409
PAYMENT_NOT_CANCELLABLE` (already succeeded or cancelled). Only QR payments
can be `PENDING`.

**QR success job** (every 1 s, batch ≤ 50): per due payment (`status =
'PENDING' AND succeed_after <= now()`, `FOR UPDATE SKIP LOCKED`), run §4.3 with
a conditional `UPDATE … WHERE status = 'PENDING'`. The server marks success,
not the client; the SPA polls `GET /v1/payments/{paymentId}`. A cancel and the
flip race on the same conditional update; exactly one wins.

### 4.3 Success bookkeeping — one atomic DB transaction (ADR-0006)

When a payment becomes `SUCCEEDED` (card: inside the request; QR: inside the
job), one DB transaction writes:

1. `payments.status = 'SUCCEEDED'`, `succeeded_at = now()`.
2. A `transactions` row: Transaction ID (UUID v4), payment reference, timestamp.
3. An `outbox_events` row of type `payment.succeeded` with the payload in
   [events/payment-succeeded.schema.json](../packages/contracts/events/payment-succeeded.schema.json)
   (`correlationId` optional).

**Payment reference** format: `PAY-<UTC yyyymmdd>-<6 chars Crockford base32
from a CSPRNG>` (e.g. `PAY-20261113-7F3K9Q`), ~1 billion values per day. On a
unique violation, regenerate and retry the insert up to 3 times inside a
savepoint; after that, roll back and return `500 INTERNAL_ERROR`.

Guarantee: after any crash, every succeeded payment has a pending outbox event;
delivery happens whenever the worker next runs.

### 4.4 Outbox worker (ADR-0006)

Polls every 2 s, up to 10 events per tick, **one DB transaction per event**:
`SELECT … FROM outbox_events WHERE status = 'PENDING' AND next_attempt_at <=
now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`. The row lock is the
claim; if the worker crashes, the transaction aborts and the event is eligible
again. HTTP timeout per call: 5 s.

Per event, **confirm first, then post**:

1. **Confirm** (skipped if `confirm_outcome` is already set):
   `POST /v1/internal/orders/{orderId}/confirm` with `{ transactionId }`.
   - `200` → `confirm_outcome = 'CONFIRMED'`.
   - `409 ORDER_NOT_CONFIRMABLE` → `confirm_outcome = 'NOT_CONFIRMABLE'`
     (terminal business outcome, not an error).
   - Anything else → transient failure (step 3).
2. **Post** `POST /v1/internal/postings` with `{ transactionId, postingType,
   orderId, paymentReference, amountMinor, currency }`, where `postingType` is
   `TICKET_SALE` if confirmed, else `UNFULFILLED_PAYMENT`. The ledger picks
   the accounts. `200`/`201` → event `DONE`, `processed_at = now()`.
3. **Transient failure** → `attempts += 1`, `last_error`, `next_attempt_at =
   now() + min(2^attempts, 300) s`. After 10 attempts (~19 min) → `FAILED`,
   error log. `confirm_outcome` is committed with the failure, so a retry never
   re-asks the Ticket Service for a different answer.

Why confirm first: the confirmation is the only step that can be legitimately
refused. Deciding it before touching the append-only ledger means revenue is
never recognized for an order that was not fulfilled; a paid but unfulfilled
order becomes a refund liability instead (ADR-0006, ADR-0009).

**Manual replay** of a `FAILED` event (runbook, after fixing the cause):

```sql
UPDATE payments.outbox_events
   SET status = 'PENDING', attempts = 0, next_attempt_at = now(), processed_at = NULL
 WHERE id = $1 AND status = 'FAILED';
```

### 4.5 Order confirmation (Ticket Service, ADR-0004)

`POST /v1/internal/orders/{orderId}/confirm`, body `{ transactionId }`. One DB
transaction; lock order is always order row, then `ticket_types` rows in
`ticketTypeCode` order (the same order as §4.1 and the expiry job):

1. `SELECT … FROM orders WHERE id = $1 FOR UPDATE` (blocking; this lock is
   what makes confirm and the expiry job's `SKIP LOCKED` compose). Not found →
   `404`.
2. Branch on the locked status:
   - `CONFIRMED` with the same `paid_transaction_id` → `200` (idempotent
     replay). With a different one → `409 ORDER_NOT_CONFIRMABLE`.
   - `PENDING` → per item `reserved -= qty, sold += qty`; set `CONFIRMED`,
     `confirmed_at`, `paid_transaction_id` → `200`.
   - `EXPIRED` → **policy: a paid order is honored if quota still allows.**
     Re-run the reservation check per item with the same guard
     (`sold + reserved + qty <= quota`) but increment `sold` directly — the
     reservation was already released. All items or none; if any item fails,
     roll back → `409 ORDER_NOT_CONFIRMABLE`.

### 4.6 Backoffice

Gateway routes, JWT required:

- `POST /v1/auth/login` → `{ accessToken, expiresIn }`.
- `GET /v1/backoffice/transactions` → Payment Service `GET /v1/transactions`.
- `GET /v1/backoffice/ledger-entries` → Ledger Service `GET /v1/journal-entries`
  ("ledger entries" in the UI = journal entries with lines).
- `GET /v1/backoffice/accounts` → Ledger Service `GET /v1/accounts` (balances;
  the live proof that Σdebits = Σcredits).
- `GET /v1/backoffice/ticket-availability` → Ticket Service
  `GET /v1/ticket-types`.

Admin: single user from env (`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, bcrypt cost
12). JWT: HS256, claims `sub` (email), `iat`, `exp` (1 h), `iss =
e-ticketing-gateway`. Expiry is the only revocation (ADR-0010).

## 5. Web app (apps/web)

| Route | Purpose | API calls |
| --- | --- | --- |
| `/` | Pick quantities of the 3 ticket types; live total; availability | `GET /v1/ticket-types` |
| `/checkout/:orderId` | Order summary, 15-min countdown, method choice: **Credit Card** or **QR Scan** (exactly two) | `POST /v1/orders` (on leaving `/`), `GET /v1/orders/{id}`, `POST /v1/payments` |
| `/checkout/:orderId/qr/:paymentId` | QR code (qrcode.react), polling, "use card instead" | `GET /v1/payments/{id}` every 1 s, `POST /v1/payments/{id}/cancel` |
| `/result/:paymentId` | Transaction ID, payment reference, timestamp, amount | `GET /v1/payments/{id}` |
| `/backoffice/login` | Admin login | `POST /v1/auth/login` |
| `/backoffice` | Tabs: transactions, ledger entries, account balances, ticket availability | `GET /v1/backoffice/*` |

The total on `/` is a preview from listed prices; the server total from
`POST /v1/orders` is authoritative and is what checkout shows.

- **Idempotency key lifecycle**: the SPA generates a UUID v4 when the user
  presses Pay and reuses it for automatic retries of that same submission
  (network error, 5xx). Any edit to the form or method makes a new key.
- **QR polling**: every 1 s; stop on `SUCCEEDED` (go to result) or after 60 s
  (show "still processing" with a manual refresh). Pauses while the tab is
  hidden.
- **Countdown**: from `expiresAt`. At zero, disable Pay and offer "start over".
- **JWT storage**: in memory plus `sessionStorage` (closes with the tab). No
  cookies, so no CSRF surface; XSS is the accepted risk for a demo backoffice.
- **Error codes → UI**:

| Code | UI |
| --- | --- |
| `QUOTA_EXCEEDED` | "Not enough tickets left", refresh availability |
| `INVALID_CARD` | Inline error on the card form |
| `ORDER_NOT_PAYABLE` | "Order expired", offer start over |
| `PAYMENT_IN_PROGRESS` | Resume the existing QR payment |
| `ORDER_ALREADY_PAID` | Go to the result page |
| `IDEMPOTENCY_KEY_REUSE` | Generate a new key and resubmit once |
| `RATE_LIMITED` | "Too many requests, try again shortly" |
| `UPSTREAM_UNAVAILABLE`, `UPSTREAM_TIMEOUT`, `INTERNAL_ERROR` | Generic retry banner |
| `UNAUTHORIZED` (backoffice) | Back to login |

- **Serving**: Vite build served by nginx in its own container; ingress routes
  `/api/*` to the gateway (prefix stripped) and everything else to the SPA.

## 6. API conventions

- OpenAPI 3.0.3 contracts in `packages/contracts/openapi/` are written first
  and are the source of truth for wire shapes (ADR-0013). Shared components
  live in `common.yaml`. `openapi-typescript` generates SPA and gateway types.
  The contract test suite (Phase 2) runs against any base URL
  (`CONTRACT_BASE_URL`) and gates the .NET port.
- Versioning: every service route is under `/v1`; health probes are exempt
  (`/health/live`, `/health/ready`).
- Errors: every non-2xx except health probes uses one envelope:

  ```json
  { "statusCode": 409, "code": "QUOTA_EXCEEDED", "message": "…", "correlationId": "…" }
  ```

  `code` is stable and machine-readable; `correlationId` is always present.
- Validation: `class-validator` (NestJS) / FluentValidation (.NET) on every
  endpoint; unknown fields rejected (`whitelist`, `forbidNonWhitelisted`).
- Pagination: `?page=1&pageSize=20` (max 100), response
  `{ data, page, pageSize, total }`, newest first.
- Swagger UI at `/docs` on every service. Exposed publicly only on the
  gateway, and only when `SWAGGER_ENABLED=true`; services are reachable only
  inside the cluster.
- Gateway behavior on downstream failure: 5 s timeout per call. Connection
  failure → `502 UPSTREAM_UNAVAILABLE`; timeout → `504 UPSTREAM_TIMEOUT`.
  Downstream 4xx/5xx bodies are passed through unchanged (status and envelope).
  The gateway never retries non-idempotent calls; `POST /v1/payments` is safe
  for the *client* to retry because of the idempotency key.

## 7. Cross-cutting

- **Health**: `/health/live` (process up) and `/health/ready` (DB reachable;
  gateway: downstream `/health/live` reachable). K8s probes use them.
- **Logging**: JSON (nestjs-pino / Serilog): `timestamp`, `level`, `service`,
  `correlationId`, `method`, `route`, `statusCode`, `durationMs`. Redacted:
  `card.number`, `card.cvc`, `authorization`, `x-api-key`, password fields.
- **Rate limits** (gateway, per IP): 100 req/min default; `POST /v1/orders`
  5/min; `POST /v1/auth/login` 10/min.
- **Headers**: helmet at the gateway; CORS allows only `WEB_ORIGIN`.
- **Config**: `@nestjs/config` with a validated schema per service. Only
  `.env.example` files are committed.

### 7.1 Environment variables

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PORT` | all services | Listen port (3000–3003) |
| `DATABASE_URL` | ticket, payment, ledger | Runtime role connection, `?schema=<name>` |
| `MIGRATION_DATABASE_URL` | ticket, payment, ledger (migrate step) | Owner role connection for migrations |
| `TICKET_SERVICE_URL` | gateway, payment | Ticket Service base URL |
| `PAYMENT_SERVICE_URL` | gateway | Payment Service base URL |
| `LEDGER_SERVICE_URL` | gateway, payment | Ledger Service base URL |
| `PUBLIC_API_KEY_TICKET` / `_PAYMENT` / `_LEDGER` | gateway (sends), each service (accepts its own) | Public-scope keys |
| `INTERNAL_API_KEY_TICKET` / `_LEDGER` | payment (sends), ticket and ledger (accept) | Internal-scope keys |
| `JWT_SECRET` | gateway | HS256 secret, ≥ 32 bytes |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | gateway | Backoffice admin |
| `WEB_ORIGIN` | gateway | CORS allowed origin |
| `SWAGGER_ENABLED` | all services | Serve `/docs` |
| `LOG_LEVEL` | all services | pino / Serilog level |
| `ORDER_TTL_MINUTES` (15), `QR_SUCCESS_DELAY_SECONDS` (8) | ticket, payment | Business timings |
| `VITE_API_BASE_URL` | web (build time) | Gateway URL, default `/api` |
| `CONTRACT_BASE_URL`, `CONTRACT_API_KEY`, `CONTRACT_INTERNAL_API_KEY` | contract tests | Target under test (public and internal-scope keys) |

## 8. Testing strategy

| Layer | What | Tools |
| --- | --- | --- |
| Unit | Luhn and expiry, request hash, payment reference, handler registry, posting templates, balance check, money math | Jest / xUnit |
| Integration | Repositories and migrations on real Postgres; the races below | Testcontainers |
| Contract | Black-box suite per service against `CONTRACT_BASE_URL`; gates the .NET port | Jest + Supertest |
| Smoke | compose up → buy → QR poll → ledger balanced | docker compose, CI |

Test-first is mandatory for payment logic, idempotency, quota reservation and
ledger posting (AGENTS.md). Required race tests: concurrent reservation at the
quota edge; two payments for one order with different keys; two identical
requests with the same key in parallel; confirm racing the expiry job;
QR flip racing cancel; ledger re-post with the same and with a different
payload.

## 9. Deployment (ADR-0011)

- **Local**: `docker compose -f infra/docker-compose.yml up -d` — Postgres,
  one-shot migrate containers, 4 services, web (nginx). Phase 5 switches the
  ticket-service image to .NET.
- **Online**: one Oracle Cloud Always Free Ampere A1 VM (ARM64, 4 OCPU,
  24 GB) running K3s; Traefik ingress; TLS from Let's Encrypt via Traefik's
  ACME resolver; free DuckDNS hostname. Images are multi-arch (amd64 + arm64)
  in GHCR. Postgres runs as a StatefulSet with a local-path volume.
- **Database bootstrap**: an init SQL script (compose:
  `docker-entrypoint-initdb.d`; K3s: Job before services) creates the three
  schemas, an owner role per schema (`*_owner`, runs migrations) and a runtime
  role per schema (`*_app`, DML only). The ledger script revokes `UPDATE`,
  `DELETE` on journal tables from `ledger_app`.
- **Migrations**: Prisma raw-SQL migrations per service, applied by a
  one-shot `migrate deploy` container (compose) or a K8s Job (K3s) using
  `MIGRATION_DATABASE_URL`, before the service starts. After the .NET port,
  the `tickets` schema keeps its Prisma SQL migrations (the NestJS service
  stays as the contract reference and migration owner); EF Core maps the
  existing schema and runs no migrations (ADR-0002).

## 10. Risks and limitations

| Risk | Mitigation or acceptance |
| --- | --- |
| Duplicate payment for one order | Partial unique index + cancel flow (§4.2) |
| Lost or duplicate ledger posting | Outbox in the success DB transaction; ledger idempotent on `transaction_id`; conflict on mismatch (§4.3, §4.4) |
| Paid order cannot be confirmed (expired, quota gone) | Posted as `UNFULFILLED_PAYMENT` to Refunds Payable; refund itself is manual and out of scope |
| Outbox event exhausts retries | `FAILED` + error log + runbook SQL (§4.4) |
| Reservation hoarding by anonymous clients | 5 orders/min/IP, max 10 per item, 15-min expiry. Guest checkout makes full prevention impossible; accepted |
| Scheduled jobs assume one replica | `SKIP LOCKED` and conditional updates make a second replica safe but wasteful; leader election is out of scope |
| Shared Postgres instance | Separate schemas and roles; noisy-neighbor risk accepted (ADR-0003) |
| Static API keys, JWT not revocable | Env-rotatable, per-scope keys; 1 h JWT; accepted (ADR-0010) |
| Single free-tier VM | No HA; accepted for a demo (ADR-0011) |
| .NET port slips | Hard start date for Phase 5 (ADR-0002) |

## 11. Requirement traceability

| Challenge requirement | Where | Interpretation |
| --- | --- | --- |
| SPA, 3 ticket types, total, checkout via API | §5, §4.1, `gateway.yaml` | Server total is authoritative |
| 2 payment methods: card (valid = success), QR (8 s) | §4.2, ADR-0008 | Luhn-invalid or expired card → 422, no payment created. "Always success" applies to every *valid* payment |
| Transaction ID, payment reference, timestamp | §4.3 | |
| Transaction record + double-entry ledger | §3.2, §3.3, §4.4, ADR-0009 | Revenue recognized on confirmation |
| Backoffice: auth, transactions, ledger, availability | §4.6, §5 | Plus account balances |
| Microservices, REST, C#/.NET for one core service | §2, ADR-0002 | Ticket Service in .NET |
| Postgres, schema design, indexes, constraints | §3, ADR-0003 | |
| API key, validation, idempotency, no secrets | §2.2, §4.2, §6, §7.1, ADR-0005, ADR-0010 | |
| Separation of tickets / orders-transactions / ledger, audit trail | §3, `orders.paid_transaction_id` | |
| Pluggable payment methods | ADR-0008 | |
| Deployed online, free domain | §9, ADR-0011 | |
| CI: lint, build, test, Docker image; bonus Sonar, coverage | Phase 8 | |
| README contents | §12 | |

## 12. Deliverable documentation

The README (Phase 9) is assembled from: architecture diagram (§2 Mermaid),
service responsibilities (§2.1), local run (§9 + AGENTS.md commands), deploy
(§9 + `infra/k8s/README.md`), environment variables (§7.1 + `.env.example`
files), API examples (contract `example` blocks as `curl`), assumptions and
trade-offs (§10, §11 interpretations, ADR index). A 5-minute demo script (buy →
QR → result → backoffice → balances) ships with it.

## 13. Decision index

| ADR | Decision | Main rejected alternative |
| --- | --- | --- |
| [0001](./adr/0001-monorepo-pnpm-turborepo.md) | pnpm + Turborepo monorepo | Repo per service |
| [0002](./adr/0002-nestjs-first-dotnet-port.md) | NestJS first; Ticket Service ported to .NET with a hard start date | .NET from day one |
| [0003](./adr/0003-one-postgres-schema-per-service.md) | One Postgres, schema and roles per service | Database per service |
| [0004](./adr/0004-quota-reservation-and-expiry.md) | Conditional-UPDATE reservation, lock order, expiry job, expired-confirm policy | SELECT FOR UPDATE then UPDATE |
| [0005](./adr/0005-idempotency-key-table.md) | Idempotency table, bind-on-create, blocking insert | Unique (order_id, method) |
| [0006](./adr/0006-transactional-outbox.md) | Transactional outbox, confirm first, row-lock claim | Message broker |
| [0007](./adr/0007-money-integer-minor-units.md) | bigint minor units + currency | NUMERIC(12,2) |
| [0008](./adr/0008-payment-strategy-registry.md) | PaymentHandler Strategy + registry | switch on method |
| [0009](./adr/0009-double-entry-append-only-ledger.md) | Double-entry, append-only, ledger-owned posting templates | Single-entry log |
| [0010](./adr/0010-auth-and-pci-scope.md) | Scoped API keys, JWT backoffice, PAN never stored | mTLS |
| [0011](./adr/0011-deployment-k3s-single-vm.md) | K3s on one free-tier ARM VM, Traefik + Let's Encrypt, DuckDNS | docker compose on a VM |
| [0012](./adr/0012-gateway-bff.md) | NestJS gateway as BFF | Traefik-only edge |
| [0013](./adr/0013-contract-first-openapi.md) | Hand-written OpenAPI 3.0.3 contracts first | Code-first Swagger |
| [0014](./adr/0014-qr-status-polling.md) | SPA polls payment status | SSE / WebSocket |
| [0015](./adr/0015-sql-first-migrations.md) | SQL-first migrations, applied with prisma migrate deploy | Prisma schema-first |
| [0016](./adr/0016-contract-validation-with-ajv.md) | Contract tests validate responses with Ajv against the bundled contract | Hand-written assertions |
