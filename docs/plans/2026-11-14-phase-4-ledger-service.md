# Phase 4 — Ledger Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A runnable NestJS Ledger Service that turns `POST /v1/internal/postings` into balanced, append-only double-entry journal entries. Postings are idempotent on `transactionId`. The service lists journal entries and derived account balances, and passes a black-box ledger contract suite.

The Payment outbox also gets the hardening deferred from Phase 3: a per-batch Ledger breaker, a hard total timeout on outbound calls, and attempt counting on persistent failures. A compose smoke test proves the whole chain: order → payment → outbox → confirm → ledger → balanced accounts.

**Architecture:** Same layers and shared plumbing as the Payment Service. The app is built on `@eticket/nest-common`: `configureApp`, `ApiKeyGuard` with public and internal scopes, the error envelope and pino logging.

- **Domain:** plain TypeScript, unit-tested. It holds:
  - the posting templates (ADR-0009);
  - the balance check;
  - the normal-side balance rule;
  - the conflict comparison.
- **Repository:** Prisma 7 `$queryRaw`.
  - One interactive transaction per posting: `INSERT … ON CONFLICT (transaction_id) DO NOTHING`, then the lines.
  - The Phase 1 deferred triggers stay the backstop at COMMIT.
- **Contract tests:** the ledger contract area is added to `packages/contract-tests`, with two runners as before.

**Tech Stack:** Node 26, NestJS 11.2.10 (CJS), Prisma 7.10.1 + `@prisma/adapter-pg`, `@nestjs/terminus`, `nestjs-pino`, `class-validator`, Jest 30 + ts-jest, Supertest, Ajv 8, Testcontainers 11. There are no new dependencies.

**Spec:** [docs/spec.md](../spec.md):

- §2.2: key scopes;
- §3.3: the ledger schema, templates, invariants and balances;
- §4.4: how the outbox calls the ledger;
- §4.6: the backoffice reads;
- §6 and §7;
- §8: the race "ledger re-post with the same and with a different payload".

Wire shapes: [ledger-service.yaml](../../packages/contracts/openapi/ledger-service.yaml). ADRs: 0009, 0006, 0010, 0018, 0019, 0020.

**Branch:** `phase-4-ledger-service` (already created from `dev`). Do not switch branches.

**Decisions taken for this plan (2026-11-14, by the user):**

- A posting whose currency is not the template accounts' currency → `400 VALIDATION_ERROR`, with no contract change.
- The outbox gets a **per-batch Ledger breaker**.
- A compose **smoke script** is added now, and Phase 8 CI will call it.

**Carried from Phase 3** (project memory `carry-forward-phase4-phase6`):

- the outbox Ledger breaker;
- a hard total timeout on outbound calls;
- attempt counting when processing an event throws at DB level;
- a fixed-text warn log for body-parse 400s.

## Global Constraints

- **Carried over from Phases 1–3:**
  - Node 26.
  - Exact pinned versions (no `^`/`~`).
  - `@eticket/*` scope.
  - Never run `prisma migrate dev`. Never read or print `infra/.env`. The test password is `test-password`.
  - `@nestjs/*` core stays on `11.2.10` and Prisma on `7.10.1`.
  - SQL migrations are **not edited**.
  - All raw SQL is a parameterized `$queryRaw` tagged template over schema-qualified tables (`ledger.*`).
- **Routes:**
  - `POST /v1/internal/postings` (`@Internal()`, internal key only);
  - `GET /v1/journal-entries?page&pageSize`;
  - `GET /v1/accounts`;
  - `GET /health/live` and `GET /health/ready`;
  - `GET /docs` (only when `SWAGGER_ENABLED=true`).
- **Error envelope** `{ statusCode, code, message, correlationId }`. Codes:
  - `VALIDATION_ERROR` 400 (including an unsupported currency);
  - `UNAUTHORIZED` 401;
  - `FORBIDDEN` 403 (the public key on `/v1/internal/*`);
  - `NOT_FOUND` 404;
  - `POSTING_CONFLICT` 409;
  - `INTERNAL_ERROR` 500;
  - plus the generic client-error codes from spec §6.
- **API keys (ADR-0010, ADR-0018):**
  - `API_KEYS = { publicKey: PUBLIC_API_KEY_LEDGER, internalKey: INTERNAL_API_KEY_LEDGER }`.
  - The public key is held by the Gateway (Phase 6). The internal key is held only by the Payment Service.
  - The internal key is also accepted on the public routes.
- **Templates (ADR-0009, spec §3.3), owned only by the Ledger:**

  | Posting type | Debit | Credit |
  | --- | --- | --- |
  | `TICKET_SALE` | `1100` Payment Gateway Clearing | `4000` Ticket Sales Revenue |
  | `UNFULFILLED_PAYMENT` | `1100` | `2100` Customer Refunds Payable |

  Each entry has exactly two lines of `amountMinor`, one DEBIT and one CREDIT. The entry currency equals the posting currency, and it must equal both accounts' currency; otherwise 400.
- **Description text** (exact): `Ticket sale <paymentReference> order <orderId>` and `Unfulfilled payment <paymentReference> order <orderId>`.
- **Idempotency (spec §3.3):**
  - Re-posting a `transactionId` whose stored entry has the same `postingType`, `orderId`, `paymentReference`, `amountMinor` and `currency` → `200` with the stored entry.
  - Any of those fields different → `409 POSTING_CONFLICT`.
  - The comparison is over all five business fields. That is stricter than the contract's "type, amount and currency" wording, but any mismatch is a producer bug that must not be swallowed.
- **Append-only:** the code never issues UPDATE or DELETE on `ledger.journal_*`. The runtime role cannot anyway, as Phase 1 tests prove.
- **Balances (spec §3.3):**
  - ASSET and EXPENSE are debit-normal: `balance = Σdebit − Σcredit`.
  - LIABILITY, EQUITY and REVENUE are credit-normal: `balance = Σcredit − Σdebit`.
  - `totals.debitMinor` and `totals.creditMinor` are sums over all lines, and must be equal.
- **Money:** `bigint` → `number` via `toMinor`. A `count(*)` or `sum()` result is converted the same way.
- **Times:** `posted_at` comes from DB `now()`. `correlation_id` is the request's `correlationIdOf(req)`.
- **Env vars (Ledger):**

  | Variable | Rule | Default |
  | --- | --- | --- |
  | `PORT` | int 1–65535 | `3003` |
  | `DATABASE_URL` | required; must contain `?schema=ledger` | — |
  | `PUBLIC_API_KEY_LEDGER` | required, ≥ 32 chars | — |
  | `INTERNAL_API_KEY_LEDGER` | required, ≥ 32 chars, ≠ public | — |
  | `SWAGGER_ENABLED` | `true` / `false` | `false` |
  | `LOG_LEVEL` | pino level | `info` |

- **Test file patterns and commits:** the same as Phase 3. Ledger contract specs go in `packages/contract-tests/src/ledger-service/*.contract.ts`.

## Review Focus

1. **Two deliveries of the same posting in parallel.** Both must answer with the same entry: one `201` and one `200`. There must be exactly one `journal_entries` row and two `journal_lines`, never a 500 from the unique violation. Test in Task 3.
2. **A re-post with a different payload,** for example a different amount or posting type. It must answer `409 POSTING_CONFLICT`. The stored entry stays unchanged, with no new lines. This includes a re-post that arrives while the first is still uncommitted. Test in Task 3.
3. **An unbalanced or wrong-currency posting reaching the DB.** The app check must answer 400 before the insert. A direct SQL insert of an unbalanced entry must still fail at COMMIT through the Phase 1 trigger; that is already covered by `schema.int-spec.ts`, so re-run it, don't duplicate it. Test in Task 3.
4. **Balances drifting from the lines.** After any mix of TICKET_SALE and UNFULFILLED_PAYMENT postings:
   - `GET /v1/accounts` totals debit = credit;
   - 1100 = the sum of every posting amount;
   - 4000 + 2100 = 1100.

   Test in Task 4, and the smoke test in Task 6.
5. **Ledger down while payments keep arriving.** The outbox must keep confirming orders, so they don't drift past the 15-minute TTL. It makes at most one Ledger call per batch, and every event is posted once the Ledger is back. Tests in Task 5, and the smoke test in Task 6.

---

## File Structure

```text
apps/ledger-service/
  package.json  tsconfig*.json  jest*.cjs  .env.example  prisma.config.ts  prisma/schema.prisma (models)
  src/main.ts  src/app.module.ts  src/config/env.ts (+spec)  src/common/prisma.service.ts
  src/health/health.controller.ts
  src/ledger/domain/{templates.ts,balance.ts,posting.ts,errors.ts} (+ *.spec.ts)
  src/ledger/{postings.controller.ts,postings.service.ts,ledger.repository.ts,journal-entry.view.ts}
  src/ledger/dto/{posting.dto.ts,list-journal-entries.query.ts}
  src/ledger/{journal-entries.controller.ts,accounts.controller.ts}
  test/support/app.ts  test/*.int-spec.ts  (schema.int-spec.ts exists)
packages/contract-tests/src/ledger-service/{suite.ts,target.ts,*.contract.ts}
packages/contract-tests/test/ledger-service.contract-spec.ts
apps/payment-service/src/outbox/outbox.worker.ts | outbox.repository.ts   (breaker, attempt bump)
apps/payment-service/src/downstream/downstream-http.ts                    (AbortSignal hard timeout)
packages/testing/src/http-stub.ts                                         (chunked trickle reply)
packages/nest-common/src/json-parse-error.ts                              (warn log)
infra/docker-compose.yml  infra/.env.example  infra/scripts/smoke.sh  infra/scripts/smoke.mjs
```

---

### Task 1: Ledger Service skeleton

**Files:**

- Modify: `apps/ledger-service/{package.json,tsconfig.json,jest.config.cjs,prisma.config.ts,prisma/schema.prisma}`.
- Create: `tsconfig.build.json`, `jest.int.config.cjs`, `.env.example`, `src/main.ts`, `src/app.module.ts`, `src/config/env.ts` + `env.spec.ts`, `src/common/prisma.service.ts`, `src/health/health.controller.ts`, `test/support/app.ts`, `test/prisma-drift.int-spec.ts`, `test/health.int-spec.ts`.

**Interfaces:**

- Consumes: `@eticket/nest-common` (`configureApp`, `API_KEYS`, `ApiKeyGuard`, `pinoHttpOptions`, `FallbackModule`, `schemaOf`, `toMinor`).
- Produces:

  ```ts
  export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables;
  export async function createApp(env: Record<string, string | undefined>, options?: { logStream?: DestinationStream }): Promise<INestApplication>;
  // test/support/app.ts
  export interface RunningLedgerService { baseUrl: string; app: INestApplication; publicKey: string; internalKey: string; close(): Promise<void> }
  export async function startLedgerService(db: TestDatabase, overrides?: Record<string, string>, options?: { logStream?: DestinationStream }): Promise<RunningLedgerService>;  // DATABASE_URL = db.urlFor('ledger_app'), fixed ≥32-char keys, LOG_LEVEL silent
  ```

- [ ] **Step 1: Mirror the Payment Service's package setup.** Copy it from `apps/payment-service`:
  - the same pins;
  - `@eticket/nest-common: workspace:*`;
  - the dev dependencies `@eticket/contract-tests`, `@eticket/contracts` and `@eticket/testing`;
  - the scripts `generate`, `build` (copies `@eticket/contracts/openapi/ledger-service.json` to `dist/openapi.json`), `lint`, `test`, `test:int` and `start`;
  - `tsconfig.build.json`, both jest configs;
  - a `prisma.config.ts` that tolerates a missing `MIGRATION_DATABASE_URL`;
  - the generator block `prisma-client`, `output ../src/generated/prisma`, `moduleFormat cjs`, `importFileExtension ""`.

  Do not use `@nestjs/axios`: the Ledger makes no outbound calls.

- [ ] **Step 2: Prisma models and the failing drift test.**
  - Models `Account`, `JournalEntry` and `JournalLine` mirror `apps/ledger-service/prisma/migrations/*/migration.sql` exactly. Use `@db.Uuid`, `@db.Char(3)`, `@db.Timestamptz(6)`, `BigInt`, and the migration's index and constraint names via `map:`.
  - The triggers, the function and the grants are outside Prisma's model. The drift test passes only if `prisma migrate diff` reports no differences. If it reports only the triggers or the function, assert the output mentions nothing else and record that in the report.

  Run: `pnpm --filter @eticket/ledger-service test:int -- prisma-drift` → FAIL, then PASS.

- [ ] **Step 3: Env unit tests, then `validateEnv`** (the table in Global Constraints):
  - defaults: `PORT 3003`, `SWAGGER_ENABLED false`;
  - `DATABASE_URL` without `schema=ledger` → throws;
  - a short `PUBLIC_API_KEY_LEDGER` → throws;
  - equal public and internal keys → throws naming `INTERNAL_API_KEY_LEDGER`;
  - every invalid variable listed in one error.

- [ ] **Step 4: `createApp`, the module, health and `.env.example`.**
  - `API_KEYS` provider: `{ publicKey: PUBLIC_API_KEY_LEDGER, internalKey: INTERNAL_API_KEY_LEDGER }`.
  - Logging uses `service: 'ledger-service'`.
  - `PrismaService` uses `schemaOf(url, 'ledger')`, `connectionTimeoutMillis` 5000, and `$disconnect` in `onApplicationShutdown`.
  - The health controller matches the Payment Service's.
  - `FallbackModule` is the last import.

  `test/health.int-spec.ts`:
  - live is 200 with no key;
  - ready is 200;
  - ready is 503 in under 3 s against `127.0.0.1:1`;
  - `GET /v1/accounts` with no key → 401;
  - `POST /v1/internal/postings` with the public key → 403. The fallback route plus the path check give this before the real route exists.

  Run: `pnpm --filter @eticket/ledger-service test && pnpm --filter @eticket/ledger-service test:int` → PASS, with `schema.int-spec.ts` still at 10.

- [ ] **Step 5: Commit.**
  Run: `pnpm lint && pnpm build && pnpm test && pnpm format:check` → pass.

  ```bash
  git add apps/ledger-service pnpm-lock.yaml
  git commit -m "feat(ledger-service): add NestJS skeleton on nest-common with config, Prisma models and health"
  ```

---

### Task 2: Ledger domain — templates, balance check, normal side, conflict rule

**Files:**

- Create: `apps/ledger-service/src/ledger/domain/{templates.ts,balance.ts,posting.ts,errors.ts}` + specs.

**Interfaces:**

- Produces:

  ```ts
  export type PostingType = 'TICKET_SALE' | 'UNFULFILLED_PAYMENT';
  export type Direction = 'DEBIT' | 'CREDIT';
  export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  export interface PostingInput { transactionId: string; postingType: PostingType; orderId: string; paymentReference: string; amountMinor: number; currency: string }
  export interface PlannedLine { accountCode: string; direction: Direction; amountMinor: number }
  export const TEMPLATES: Record<PostingType, { debit: string; credit: string; describe(p: PostingInput): string }>;
  export function planEntry(p: PostingInput): { description: string; lines: PlannedLine[] };      // exactly 2 lines, throws if not balanced
  export function assertBalanced(lines: PlannedLine[]): void;                                    // ≥2 lines, Σdebit = Σcredit, every amount a positive safe integer
  export function isDebitNormal(type: AccountType): boolean;                                     // ASSET, EXPENSE
  export function balanceOf(type: AccountType, debitMinor: number, creditMinor: number): number;
  export function samePosting(stored: PostingInput, incoming: PostingInput): boolean;           // all five business fields (transactionId equal by construction)
  // errors (DomainError subclasses from nest-common)
  export class UnsupportedCurrencyError {}   // 400 VALIDATION_ERROR, message "currency <X> is not supported by the ledger accounts"
  export class PostingConflictError {}       // 409 POSTING_CONFLICT, message names the transactionId only
  export class UnbalancedEntryError {}       // 500 INTERNAL_ERROR (an invariant breach, never a client error)
  ```

- [ ] **Step 1: Write the failing unit tests.**
  - `planEntry(TICKET_SALE, 70000)` gives exactly:

    ```ts
    [{ accountCode: '1100', direction: 'DEBIT', amountMinor: 70000 }, { accountCode: '4000', direction: 'CREDIT', amountMinor: 70000 }]
    ```

    with the description `Ticket sale PAY-20261113-7F3K9Q order <uuid>`.
  - `UNFULFILLED_PAYMENT` → credit `2100`, description `Unfulfilled payment …`.
  - `assertBalanced`:
    - one line → throws;
    - an unequal debit/credit → throws;
    - `0` or `1.5` → throws;
    - two equal lines → ok.
  - `balanceOf`:
    - `('ASSET', 100, 30)` → 70;
    - `('REVENUE', 30, 100)` → 70;
    - `('LIABILITY', 0, 50)` → 50;
    - `('EXPENSE', 10, 0)` → 10.
  - `samePosting`: identical → true; each of the five fields changed in turn → false (`it.each`).

  Run: `pnpm --filter @eticket/ledger-service test` → FAIL.

- [ ] **Step 2: Implement the code to make the tests pass.** Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/ledger-service
  git commit -m "feat(ledger-service): add posting templates, balance check and normal-side balances"
  ```

---

### Task 3: `POST /v1/internal/postings` — idempotent, conflict-checked, balanced

**Files:**

- Create: `src/ledger/{postings.controller.ts,postings.service.ts,ledger.repository.ts,journal-entry.view.ts}`, `src/ledger/dto/posting.dto.ts`, `test/postings.int-spec.ts`.
- Create: `packages/contract-tests/src/ledger-service/{suite.ts,target.ts,health.contract.ts,auth.contract.ts,postings.contract.ts}`, `packages/contract-tests/test/ledger-service.contract-spec.ts`, `apps/ledger-service/test/contract.int-spec.ts`.
- Modify: `packages/contract-tests/src/index.ts`, `packages/contract-tests/package.json` (add the script `test:contract:ledger`).

**Interfaces:**

- Consumes: Task 2 domain; `isUniqueViolation`, `toMinor`, `correlationIdOf`, `Internal`.
- Produces:

  ```ts
  export interface JournalEntryView { id: string; transactionId: string; postingType: PostingType; orderId: string; paymentReference: string; description: string; currency: string; correlationId: string | null; postedAt: string; lines: Array<{ id: string; accountCode: string; accountName: string; direction: Direction; amountMinor: number }> }
  export class LedgerRepository {
    accountsByCode(codes: string[]): Promise<Map<string, { id: string; currency: string }>>;
    postEntry(p: PostingInput, planned: { description: string; lines: PlannedLine[] }, correlationId: string): Promise<{ kind: 'CREATED'; view: JournalEntryView } | { kind: 'EXISTING'; stored: PostingInput; view: JournalEntryView }>;
    findByTransactionId(transactionId: string): Promise<JournalEntryView | null>;
  }
  export class PostingsService { post(p: PostingInput, correlationId: string): Promise<{ status: 200 | 201; view: JournalEntryView }> }
  // contract-tests
  export interface LedgerContractTarget { baseUrl: string; publicApiKey: string; internalApiKey: string }
  export function ledgerTargetFromEnv(): LedgerContractTarget;  // CONTRACT_LEDGER_BASE_URL, CONTRACT_LEDGER_API_KEY, CONTRACT_LEDGER_INTERNAL_API_KEY
  export function runLedgerServiceContract(getTarget: () => LedgerContractTarget): void;
  ```

**`PostingsService.post`:**

1. Call `planEntry(p)`, then `assertBalanced`.
2. Check the currency: look up the two template accounts with `accountsByCode`. If `p.currency` is not equal to both accounts' currency → `UnsupportedCurrencyError` (400). This runs before any write.
3. Call `repo.postEntry`. `CREATED` → 201.
4. `EXISTING` → `samePosting(stored, p)` ? 200 with the stored view : `PostingConflictError` (409).

**`postEntry`**, in one interactive `$transaction` with `{ maxWait: 5000, timeout: 10000 }`:

1. Insert the entry:

   ```sql
   INSERT INTO ledger.journal_entries (transaction_id, posting_type, payment_reference, order_id, description, currency, correlation_id)
   VALUES (…) ON CONFLICT (transaction_id) DO NOTHING RETURNING id
   ```

   This blocks behind an uncommitted entry with the same `transaction_id`.
2. Zero rows → read the stored entry and its lines, and return `EXISTING`. Nothing new is written.
3. Otherwise insert the two lines, with the account ids from step 2 of the service, and return `CREATED` with the view read in the same transaction.

The deferred triggers check balance and currency at COMMIT. A trigger error is a 500 (`UnbalancedEntryError` is never expected; the app check comes first).

**Controller:**

- `@Internal() @Controller('v1/internal/postings')`;
- `POST` with `@Res({ passthrough: true })` to set 200 or 201;
- the body DTO follows the contract `PostingRequest`:
  - `transactionId` and `orderId` `@IsUUID()`;
  - `postingType` `@IsIn`;
  - `paymentReference` `@IsString @Length(1, 64)`;
  - `amountMinor` `@IsInt @Min(1)`, plus a safe-integer check;
  - `currency` `@Matches(/^[A-Z]{3}$/)`;
- unknown fields → 400.

- [ ] **Step 1: Write the failing integration tests** `test/postings.int-spec.ts` (fresh DB per `describe`):
  - **New TICKET_SALE:**
    1. 201, with the body valid against the contract `createPosting` 201.
    2. Two lines: 1100 DEBIT and 4000 CREDIT, both 70000, carrying `accountName`.
    3. The description is exact.
    4. `correlationId` equals the request's `X-Correlation-Id` UUID.
    5. The DB has 1 entry and 2 lines.
  - **The same posting again:** 200 with a deep-equal body. The DB still has 1 entry and 2 lines.
  - **Conflict** (`it.each` over a different `amountMinor`, a different `postingType`, a different `orderId`, a different `paymentReference`): 409 `POSTING_CONFLICT`. The stored entry is unchanged and no lines are added.
  - **UNFULFILLED_PAYMENT:** credit 2100.
  - **Currency `USD`:** 400 `VALIDATION_ERROR`, and no rows are written.
  - **Validation:** missing fields, `amountMinor: 0`, `amountMinor: '100'`, a non-UUID `transactionId`, the extra field `lines` → 400.
  - **Keys:** the public key → 403 `FORBIDDEN`; no key → 401.
  - **Race (Review Focus 1):**
    1. Send 8 concurrent identical postings.
    2. Expect exactly one 201 and seven 200.
    3. All bodies are deep-equal.
    4. The DB has 1 entry and 2 lines, with no 500.
  - **Race with a conflict (Review Focus 2):**
    1. Send 4 concurrent identical postings and 4 with a different amount, all with the same `transactionId`.
    2. Expect exactly one 201. Every other response is either 200 (matching the winner) or 409 (differing from the winner).
    3. No 500.
    4. The stored amount equals the winner's.
  - **The trigger still works:** re-run `schema.int-spec.ts` unchanged.

- [ ] **Step 2: Write the failing ledger contract area.**
  - `health.contract.ts`;
  - `auth.contract.ts`: no key → 401; the public key on postings → 403; an unknown route with a key → 404;
  - `postings.contract.ts`, run with the internal key and validated with `ContractValidator.load('ledger-service')`. It uses a fresh random `transactionId` per test, so it is target-agnostic:
    - create → 201;
    - replay → 200, deep-equal;
    - a different amount → 409;
    - `USD` → 400;
    - an invalid body → 400.

  Runner 1 is `apps/ledger-service/test/contract.int-spec.ts`. Runner 2 is `packages/contract-tests/test/ledger-service.contract-spec.ts`. Add the script `test:contract:ledger`.

  Run: `pnpm --filter @eticket/ledger-service test:int` → FAIL.

- [ ] **Step 3: Implement** the repository, service, view, DTO, controller and wiring.
  Run: `pnpm --filter @eticket/ledger-service test && pnpm --filter @eticket/ledger-service test:int` → PASS.

- [ ] **Step 4: Commit.**

  ```bash
  git add apps/ledger-service packages/contract-tests
  git commit -m "feat(ledger-service): post idempotent double-entry journal entries with conflict detection"
  ```

---

### Task 4: `GET /v1/journal-entries` and `GET /v1/accounts`

**Files:**

- Create: `src/ledger/{journal-entries.controller.ts,accounts.controller.ts}`, `src/ledger/dto/list-journal-entries.query.ts`, `test/reads.int-spec.ts`, `packages/contract-tests/src/ledger-service/reads.contract.ts`.
- Modify: `ledger.repository.ts`.

**Interfaces:**

- Produces:

  ```ts
  // LedgerRepository
  listEntries(page: number, pageSize: number): Promise<{ data: JournalEntryView[]; total: number }>;   // posted_at DESC, id DESC; lines fetched in ONE query for the page's entry ids (no N+1)
  accountBalances(): Promise<{ data: AccountView[]; totals: { debitMinor: number; creditMinor: number } }>;  // ordered by code
  export interface AccountView { code: string; name: string; type: AccountType; currency: string; debitMinor: number; creditMinor: number; balanceMinor: number }
  ```

  - The query DTO is the same as the Payment Service's `list-transactions.query.ts`: `@Type(() => Number)`, `page ≥ 1`, `pageSize` 1–100, defaults 1 and 20.
  - Accounts are read with one aggregate query: `LEFT JOIN journal_lines … GROUP BY account`, `COALESCE(sum(…) FILTER (WHERE direction = 'DEBIT'), 0)`. Balance comes from `balanceOf`.
  - Line order within an entry is DEBIT first, then CREDIT, then by account code.

- [ ] **Step 1: Write the failing tests.**
  - **Integration** (`test/reads.int-spec.ts`):
    - **Empty ledger:** accounts lists 1100, 2100 and 4000, with all zeros and totals 0/0.
    - **After postings:** TICKET_SALE 70000, TICKET_SALE 10000 and UNFULFILLED_PAYMENT 20000 give:
      - 1100: debit 100000, credit 0, balance 100000;
      - 4000: credit 80000, balance 80000;
      - 2100: credit 20000, balance 20000;
      - totals 100000/100000.
    - **Review Focus 4:** 1100 = 4000 + 2100.
    - **Journal entries:**
      - `pageSize=2` → 2 entries, newest first, `total 3`, each with 2 lines;
      - `page=2` → 1 entry;
      - the body is valid against `listJournalEntries`;
      - `pageSize=101` → 400.
  - **Contract** (`reads.contract.ts`, target-agnostic):
    1. Read the accounts. Assert `totals.debitMinor === totals.creditMinor` and that each account's balance follows its normal side.
    2. Post one TICKET_SALE of 5000 with the internal key, then read again. Assert that 1100's debit and 4000's credit each rose by exactly 5000.
    3. Journal entries 200 are valid against the contract.
    4. The public key is accepted on both reads.

  Run → FAIL.

- [ ] **Step 2: Implement.** Run → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/ledger-service packages/contract-tests
  git commit -m "feat(ledger-service): list journal entries and derived account balances"
  ```

---

### Task 5: Payment outbox hardening — Ledger breaker, hard timeout, attempt counting, parse-error log

**Files:**

- Modify: `apps/payment-service/src/outbox/{outbox.worker.ts,outbox.repository.ts}`, `apps/payment-service/src/downstream/downstream-http.ts`, `apps/payment-service/test/{outbox.int-spec.ts,downstream.int-spec.ts}`.
- Modify: `packages/testing/src/http-stub.ts` (+ its test), `packages/nest-common/src/json-parse-error.ts` (+ spec), `docs/spec.md` §4.4, `docs/adr/0006-transactional-outbox.md` (amendment note).

**Interfaces:**

- Produces:

  ```ts
  // @eticket/testing — StubReply gains a trickle form:
  export type StubReply = { status: number; body?: unknown; delayMs?: number; chunkDelayMs?: number } | 'drop';
    // chunkDelayMs: write headers at once, then the JSON body one byte every chunkDelayMs
  // OutboxWorker (behaviour, same public API)
  runOnce(): Promise<number>;
  ```

**Behaviour:**

1. **Per-batch Ledger breaker** (user decision).
   - Inside one `runOnce`, after the first `LedgerClient.post` failure of any kind, every later event in the same batch still runs the confirm step (if `confirm_outcome` is null). It then goes to RETRY with `last_error = 'ledger skipped: unavailable earlier in this batch'` **without calling the Ledger**.
   - A skipped event counts as an attempt, using the same backoff and FAILED rule as a real failure, because the Ledger was in fact unavailable.
   - The breaker resets at the next `runOnce`.
   - Add one sentence to spec §4.4 and an "Amended 2026-11-14" note to ADR-0006.
2. **Hard total timeout.** Every outbound request in `downstream-http.ts` also passes `signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS)`. axios `timeout` is an idle timeout. `ERR_CANCELED` already maps to `UpstreamTimeoutError`; keep that, and add a code comment saying why.
3. **Attempt counting when processing throws** (Phase 3 parked item).
   - If `processOne` throws after it has claimed an event (a DB error, or a transaction timeout), the claiming transaction has rolled back.
   - The repository then records the attempt in a **separate short transaction**:

     ```sql
     UPDATE … SET attempts = attempts + 1, last_error = ${msg ≤ 500},
            next_attempt_at = now() + backoff,
            status = CASE WHEN attempts + 1 >= max THEN 'FAILED' ELSE status END,
            processed_at = CASE … END
      WHERE id = ${claimedId} AND status = 'PENDING'
     ```

     Then it rethrows.
   - The worker keeps its stop-the-batch rule.
   - A persistent DB-level failure therefore now reaches `FAILED` after `OUTBOX_MAX_ATTEMPTS` instead of looping forever.
4. **Parse-error log.** `jsonParseErrorMiddleware` in nest-common logs `warn { correlationId, statusCode: 400 }`, `'malformed request body'`. The message is fixed text and never includes the parser message. It runs before pino-http, so use the Nest `Logger` or a logger passed into `configureApp`, whichever needs no new wiring. Note the choice in the report.

- [ ] **Step 1: Write the failing tests.**
  - **Breaker** (`outbox.int-spec.ts`):
    1. Seed 5 card payments, so there are 5 events.
    2. Confirm stub → 200; Ledger stub → `'drop'` (connection error).
    3. Run `runOnce()` → 5.
    4. The Ledger stub saw **exactly 1** call, and the confirm stub saw 5.
    5. All 5 events are PENDING with `attempts 1` and `confirm_outcome 'CONFIRMED'`. Four have `last_error` starting with `ledger skipped`.
    6. Fix the Ledger stub (201), set `next_attempt_at = now()` by SQL, and run `runOnce()` again.
    7. All 5 are DONE, the Ledger saw 5 more calls, and the confirm stub saw **no** new calls.
  - **Breaker with slow failures:**
    1. Ledger stub delay > `DOWNSTREAM_TIMEOUT_MS: '300'`, 3 events.
    2. `runOnce()` finishes in under `3 × 300` ms plus margin, i.e. it makes only one timed-out call.
    3. Assert an elapsed time under 900 ms on top of the confirm calls.
  - **Hard timeout** (`downstream.int-spec.ts`):
    1. Ledger stub `{ status: 201, body: <valid JournalEntry>, chunkDelayMs: 200 }`, with a body of about 300 bytes so it trickles for about 60 s.
    2. Use `DOWNSTREAM_TIMEOUT_MS: '500'`.
    3. `post` rejects with `UpstreamTimeoutError` in under 1.5 s.
  - **Attempt counting:**
    1. Make `OutboxRepository`'s update step throw once after the claim. Spy on the internal update, or inject a failure through a test seam the implementer chooses and documents.
    2. `runOnce()` → the event is PENDING with `attempts 1` and `last_error` set.
    3. With `OUTBOX_MAX_ATTEMPTS: '2'` and the failure persisting, the second run → `FAILED`.
  - **Parse log** (nest-common spec): a malformed body produces exactly one captured warn line, with the correlation ID and `statusCode 400`, that contains no part of the body.

  Run → FAIL.

- [ ] **Step 2: Implement.**
  Run:

  ```bash
  pnpm --filter @eticket/payment-service test:int && pnpm --filter @eticket/testing test:int && pnpm --filter @eticket/nest-common test && pnpm --filter @eticket/ticket-service test:int
  ```

  → PASS.

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/payment-service packages/testing packages/nest-common docs/spec.md docs/adr/0006-transactional-outbox.md
  git commit -m "fix(payment-service): add a per-batch ledger breaker, hard call timeout and attempt counting on outbox failures"
  ```

---

### Task 6: Compose, standalone contract run, smoke test, docs, phase gate

**Files:**

- Modify: `infra/docker-compose.yml`, `infra/.env.example`, `AGENTS.md` (Commands), `packages/contract-tests/README.md`, `docs/spec.md` §7.1.
- Create: `infra/scripts/smoke.sh`, `infra/scripts/smoke.mjs`.

- [ ] **Step 1: Compose `ledger-service`.**
  - Use the shared `infra/docker/nest-service.Dockerfile` with `SERVICE=ledger-service` and `PORT=3003`.
  - `depends_on`: postgres (healthy) and migrate-ledger (completed successfully).
  - Environment, using `${VAR:?…}` for every secret:
    - `PORT 3003`
    - `DATABASE_URL postgresql://ledger_app:${LEDGER_APP_PASSWORD:?…}@postgres:5432/eticketing?schema=ledger`
    - `PUBLIC_API_KEY_LEDGER`
    - `INTERNAL_API_KEY_LEDGER`
    - `SWAGGER_ENABLED 'true'`
    - `LOG_LEVEL info`
  - `ports: ['127.0.0.1:3003:3003']`, and a healthcheck on `/health/ready`.
  - Add `ledger-service` (healthy) to payment-service's `depends_on`.
  - Update the payment-service comment: the Ledger now exists.
  - `.env.example`: add `PUBLIC_API_KEY_LEDGER` with a ≥ 32-char placeholder.
  - **Never read or print `infra/.env`.** Append the key only if it is missing:

    ```bash
    grep -q '^PUBLIC_API_KEY_LEDGER=' infra/.env || printf 'PUBLIC_API_KEY_LEDGER=%s\n' "$(openssl rand -hex 32)" >> infra/.env
    ```

  - Build check: `docker build -f infra/docker/nest-service.Dockerfile --build-arg SERVICE=ledger-service --build-arg PORT=3003 -t eticket/ledger-service:dev .` → succeeds, and `docker inspect` shows `PORT=3003`.

- [ ] **Step 2: Smoke script** (user decision). `infra/scripts/smoke.sh`:
  1. `docker compose down -v`, then `up -d --build --wait ticket-service payment-service ledger-service`.
  2. `set -a; . infra/.env; set +a`.
  3. `node infra/scripts/smoke.mjs`.
  4. `down -v` on exit, through a trap. Pass `--keep` to skip the teardown.

  `smoke.mjs` uses Node 26 global `fetch` only, with no dependencies. It reads the keys from env, prints one line per step and never prints a key. Each step fails with a non-zero exit and a clear message:
  1. **Card order.** `POST :3001/v1/orders` GOLD×2 with `PUBLIC_API_KEY_TICKET` → order A (20000). `POST :3002/v1/payments` CARD with `Idempotency-Key` = a random UUID and `PUBLIC_API_KEY_PAYMENT` → `SUCCEEDED`.
  2. **QR order.** Order B is PREMIUM×1 (20000). Pay it by QR → PENDING. Poll `GET :3002/v1/payments/{id}` every 1 s, for up to 20 s, until `SUCCEEDED`.
  3. **Ledger.** Poll `GET :3003/v1/journal-entries?pageSize=100` with `PUBLIC_API_KEY_LEDGER` every 1 s, for up to 30 s, until both payments' `transactionId`s appear as `TICKET_SALE` entries.
  4. **Orders.** `GET :3001/v1/orders/{A,B}` → both `CONFIRMED`, and `paidTransactionId` equals each payment's `transaction.transactionId`.
  5. **Accounts.** `GET :3003/v1/accounts`:
     - `totals.debitMinor === totals.creditMinor === 40000`;
     - 1100 balance 40000, 4000 balance 40000, 2100 balance 0.

     This assumes a fresh volume, which the script guarantees.
  6. Print `SMOKE OK`.

  Run: `infra/scripts/smoke.sh` → `SMOKE OK`.

- [ ] **Step 3: Standalone contract runs against compose.**
  1. Bring the stack up with `--keep`, or `up -d --wait` on a fresh volume.
  2. Run, in order: `test:contract:ticket`, then `test:contract:payment`, then `test:contract:ledger`, each with its env. Keys come from `infra/.env` via `set -a`.
  3. After the payment suite, wait up to 30 s, then query:

     ```sql
     SELECT status, count(*) FROM payments.outbox_events GROUP BY status
     ```

     Expect only `DONE`. The Ledger is up now, so every event must be delivered.
  4. Key-leak counts in all three service logs (count only) → 0.
  5. `down -v`.

- [ ] **Step 4: Docs.**
  - **Contract-tests README:** the ledger area, its env vars (`CONTRACT_LEDGER_BASE_URL`, `CONTRACT_LEDGER_API_KEY`, `CONTRACT_LEDGER_INTERNAL_API_KEY`) and `test:contract:ledger`.
  - **AGENTS.md Commands:**
    - Ledger Service: `test` (unit) and `test:int` (integration);
    - the ledger contract run;
    - `Smoke test (Docker running): infra/scripts/smoke.sh`.
  - **Spec §7.1:** the contract-tests row gains the ledger variables.

- [ ] **Step 5: Phase gate**, from a clean state:

  ```bash
  docker compose -f infra/docker-compose.yml down -v
  pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test && pnpm test:int && pnpm format:check
  infra/scripts/verify-db.sh && infra/scripts/smoke.sh
  ```

  Expected: every command passes, `verify-db.sh` prints `DB OK`, and the smoke test prints `SMOKE OK`. Report the per-suite counts.

- [ ] **Step 6: Commit.**

  ```bash
  git add infra AGENTS.md packages/contract-tests/README.md docs/spec.md
  git commit -m "feat(infra): add ledger-service to compose and an end-to-end smoke test"
  ```

---

## Execution options

Pick one. Both run the same tasks in order, one commit per task.

**A — Claude Code subagents (Sonnet 5.5).** In Claude Code:

> Execute `docs/plans/2026-11-14-phase-4-ledger-service.md` with superpowers:subagent-driven-development.

A fresh Sonnet subagent implements each task, and a reviewer checks it before the next one starts. Tasks 3 and 5 (idempotent posting and the outbox concurrency changes) get Opus reviewers.

**B — OpenCode hand-off (saves Claude tokens).** You are already on `phase-4-ledger-service`. From the repo root:

```bash
opencode run "Read AGENTS.md, docs/spec.md and docs/plans/2026-11-14-phase-4-ledger-service.md. \
You are on branch phase-4-ledger-service; do not switch or create branches. Execute the plan's \
tasks 1 to 6 in order. For each task follow every step exactly, write the failing test before the \
code, run every Run command and compare with Expected, and make the commit given in the task. \
Do not edit SQL migrations or packages/contracts/openapi. Edit docs/spec.md and docs/adr only \
where Tasks 5 and 6 say so. Never run 'prisma migrate dev'. Never read or print infra/.env; only \
append missing keys as Task 6 shows. Pin exact dependency versions; add no new dependencies. If a \
verification still fails after two fix attempts, stop and report the task, the command and its \
full output; never skip or weaken a test. Finish by printing each task's commit hash and the full \
Task 6 phase-gate output."
```

**After either option**, back in Claude Code (Opus):

- a whole-branch review on Opus, then one fix wave;
- the EGM drift check against spec §3.3, §4.4 and §4.6;
- the phase summary.
