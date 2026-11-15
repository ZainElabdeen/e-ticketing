# Phase 7b — Local Demo Setup, Seed Purchases and Demo Guide

> **For agentic workers:** Execute task by task. Steps use checkbox (`- [ ]`) syntax. Non-Claude agents (OpenCode): follow the tasks in order; every step is self-contained.

**Goal:** One command prepares a fresh clone to run locally in Docker, with every secret generated and the backoffice login shown once in the user's own terminal. A second command fills the system with real demo purchases. One guide, `docs/local-demo.md`, tells a reviewer how to run, log in, test and demo every challenge requirement. The Phase 9 README will link to it.

**Architecture:**

- **Setup script.** `infra/scripts/setup-local.mjs` is plain Node ESM, like the other infra scripts.
  - It writes `infra/.env` from `infra/.env.example`.
  - It reuses the bcrypt logic in `admin-hash.mjs`, extracted into a shared module.
  - It is idempotent and never overwrites a real value unless asked.
- **Seed script.** `infra/scripts/seed-demo.mjs` buys tickets through the public Gateway API, exactly as the SPA does. It never inserts rows by hand, so every demo row has a full audit trail: order, payment, transaction, outbox, journal entry.
- **Guide.** `docs/local-demo.md` documents everything.

**Spec:** [docs/spec.md](../spec.md) §3 (seeded ticket types and accounts), §4.2 (payments), §4.6 (admin login), §7.1 (env vars). Requirements: [docs/challenge.md](../challenge.md) §2, §3 (no secrets committed) and §5–§6 (demo).

**Branch:** `phase-7b-local-demo`, created from `dev`.

**Decisions (2026-11-15, by the user):**

1. **Login details.**
   - The setup script generates or accepts the admin password, stores only its hash plus `ADMIN_PASSWORD_DEV` in the git-ignored `infra/.env`, and prints the login once in the user's terminal.
   - `--reset-admin` makes a new password at any time.
   - No credential is ever committed.
2. **Seeds.**
   - Required seeds stay in the migrations: the three ticket types and the two ledger accounts.
   - A new demo seed makes real purchases through the API: card and QR.
3. **Guide scope.** Quick start, login, seeds, test cards, the QR simulation, URLs and ports, and a demo script mapped to the challenge requirements.

## Global Constraints

- **Never commit `infra/.env`.** Never print a secret in CI, test output or agent transcripts. The admin password is printed only by `setup-local.mjs`, only in the run that sets it, and only to an interactive terminal (`process.stdout.isTTY`). With a non-TTY stdout it writes the password to `infra/.admin-login.txt` (mode 600, git-ignored) and prints that path instead.
- **File handling.**
  - `infra/.env` is written with mode 600.
  - Existing non-placeholder values are never overwritten, except the admin keys under `--reset-admin`.
  - A placeholder is an empty value, or a value starting with `replace-with` or `change-me` (case-insensitive).
- **Secret generation.**
  - Use `node:crypto` `randomBytes`.
  - Passwords and API keys: 32 hex bytes (64 characters). `JWT_SECRET`: 48 bytes hex.
  - Generated admin password: 20 characters from an unambiguous alphabet (no `0O1lI`), at most 72 UTF-8 bytes (bcrypt).
  - Bcrypt cost: 12.
- **Dependencies.** No new ones. `bcryptjs` is loaded from the gateway package the same way `admin-hash.mjs` does today, so `pnpm install` is a prerequisite. State this in the guide.
- **Seed script.**
  - It uses the gateway's wrong-target guard (`gateway-target.mjs`) before any request.
  - It respects rate limits: on a 429 it waits `Retry-After` seconds and retries the same request with the same idempotency key, up to 3 times.
- **Process.** Lint covers `infra/scripts` (root `pnpm lint`). Commit with conventional commits ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: `setup-local.mjs` (+ shared admin module) with tests

**Files:**

- Create:
  - `infra/scripts/lib/admin-hash-lib.mjs`: `hashAdminPassword(password: string): Promise<string>` returns the base64 bcrypt hash, cost 12, and throws on more than 72 bytes. `generatePassword(length = 20): string`.
  - `infra/scripts/setup-local.mjs`.
  - `infra/scripts/setup-local.test.mjs`, which uses `node:test`.
- Modify:
  - `infra/scripts/admin-hash.mjs`: use the lib, with no behaviour change.
  - root `package.json`: `"test": "turbo run test && node --test infra/scripts/"`.
  - `.gitignore`: add `infra/.admin-login.txt`.
  - `AGENTS.md` Commands.

**CLI:**

```
node infra/scripts/setup-local.mjs [--email <addr>] [--password-stdin] [--reset-admin] [--env <path>] [--no-ports]
```

**Behaviour, as pure functions exported for tests, with a thin `main`:**

- `parseEnv(text) → Map` and `renderEnv(exampleText, values) → string`. `renderEnv` keeps the comments and key order of the example. It turns commented-out optional keys (`# KEY=`) into real lines only when a value is set.
- `fillSecrets(values, rand) → { values, generated: string[] }`.
  - It fills every placeholder secret key from the example: the `*_PASSWORD`, `*_API_KEY_*` and `JWT_SECRET` keys.
  - It never touches non-placeholder values.
  - It returns only the key names it generated.
- **Admin.** When `ADMIN_EMAIL` or `ADMIN_PASSWORD_HASH_B64` is missing, or `--reset-admin` is given:
  - Email: `--email`, else `admin@eticket.local`.
  - Password: when stdin is a TTY, a prompt with echo off ("Admin password (leave empty to generate):"). With `--password-stdin`, read it from stdin. Otherwise generate one.
  - It must be 8–72 UTF-8 bytes.
  - Write `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH_B64` and `ADMIN_PASSWORD_DEV` (the same password, used by smoke and contract tests).
- **Ports** (skipped with `--no-ports`).
  - For each of `GATEWAY_HOST_PORT` 3000, `POSTGRES_HOST_PORT` 5432 and `WEB_HOST_PORT` 8080 that is not set yet: if the default port is busy on 127.0.0.1 (`net.createServer().listen` test), pick the first free port from default+100 upward and set the key.
  - Print one line per changed port: "Port 3000 is busy; gateway will use 3100".
- **Output.**
  - Write the file with mode 600.
  - Print the generated key names and changed ports.
  - When the admin password was set in this run:

    ```
    Backoffice login (shown once — store it now):
      URL:      http://127.0.0.1:<WEB_HOST_PORT|8080>/backoffice
      Email:    <email>
      Password: <password>
    ```

    Use the non-TTY file fallback per Global Constraints.
  - Otherwise print "Admin login unchanged (use --reset-admin for a new password)".
  - Last line: "Next: docker compose -f infra/docker-compose.yml up -d --build --wait". If the stack is already running and the admin keys changed, print "Restart the gateway: docker compose -f infra/docker-compose.yml up -d gateway".

- [ ] **Step 1: Write the failing tests** (`node --test infra/scripts/`). Use temp dirs only, never the real `infra/.env`.
  - `fills every placeholder secret from the example and leaves real values alone`.
  - `generated values are hex of the required length`.
  - `keeps comments and key order of the example`.
  - `optional commented keys become real lines only when set`.
  - `does not regenerate on a second run (idempotent)`: the file is byte-identical except nothing changes.
  - `--reset-admin replaces only the three admin keys`.
  - `hashAdminPassword` hash verifies with bcryptjs `compare`.
  - Password limits: a password over 72 bytes is rejected, and one under 8 is rejected.
  - `generatePassword` returns 20 characters from the unambiguous alphabet.
  - `non-TTY run writes the login file with mode 600 and does not print the password`: spawn the script with piped stdio, `--password-stdin`, a temp `--env`, and `--no-ports`, then assert stdout lacks the password.
  - `busy default port picks a free alternative`: occupy a random port, and call the exported `pickPort(defaultPort)`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Refactor `admin-hash.mjs` onto the lib; its existing behaviour and spec tests must stay green (`apps/gateway/src/config/admin-hash-script.spec.ts`).
- [ ] **Step 4:** Run `node --test infra/scripts/`, `pnpm --filter @eticket/gateway test`, `pnpm lint` and `pnpm format:check`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(infra): one-command local setup that generates secrets and the admin login`.

### Task 2: `seed-demo.mjs` — real demo purchases through the gateway

**Files:**

- Create:
  - `infra/scripts/seed-demo.mjs`;
  - `infra/scripts/seed-demo.sh`, which runs `node --env-file=infra/.env infra/scripts/seed-demo.mjs "$@"` from the repo root and exits non-zero on failure.
- Modify: `AGENTS.md` Commands.

**Behaviour:**

- **Base URL.** `SEED_GATEWAY_URL`, else `http://127.0.0.1:${GATEWAY_HOST_PORT ?? 3000}`. Call `gateway-target.mjs` first and abort if the target is not the gateway.
- **Purchases.** The plan below is a constant list. Each purchase:
  1. `POST /v1/orders`.
  2. `POST /v1/payments` with a fresh `Idempotency-Key` (`crypto.randomUUID()`) and the amount taken from the order, never from the client.
  3. For QR, poll `GET /v1/payments/{id}` every 1 s until `SUCCEEDED` (timeout 30 s).
  4. Then poll `GET /v1/orders/{id}` until `CONFIRMED` (timeout 30 s). This proves the outbox posted the ledger entry and confirmed the order.

  | # | Items | Method | Card |
  | --- | --- | --- | --- |
  | 1 | GOLD ×2 | CARD | 4242 4242 4242 4242 (Visa test number), holder "Demo Visa", exp 12/30, cvc 123 |
  | 2 | PREMIUM ×1 | CARD | 5555 5555 5555 4444 (Mastercard test number), holder "Demo Mastercard" |
  | 3 | VIP ×1 | QR | — |
  | 4 | GOLD ×1, PREMIUM ×1 | CARD | 4242 4242 4242 4242 |

- **429 handling.** Wait `Retry-After` seconds and retry the same request (same key for payments), max 3 times. The orders limit is 5/min, so four orders fit.
- **Output.**
  - One line per purchase: `#1 GOLD×2 card AED 200.00 PAY-… CONFIRMED`.
  - Totals: tickets bought, AED charged, and remaining availability per type (`GET /v1/ticket-types`).
  - Last line: `SEED OK`.
  - It never prints card numbers. The masked form `card ending 4242` is fine.
- **Flags.** `--dry-run` prints the plan without calling anything.

- [ ] **Step 1:** Implement. Export the pure helpers (`formatAed`, `purchasePlan`) and add `infra/scripts/seed-demo.test.mjs` with `node:test`:
  - `plan totals`: 200 + 200 + 500 + 300 = AED 1,200.00;
  - `formatAed(120000) === 'AED 1,200.00'`;
  - `no card number in rendered lines`.
- [ ] **Step 2:** Bring the stack up (`docker compose -f infra/docker-compose.yml up -d --build --wait`), run `infra/scripts/seed-demo.sh`, and expect `SEED OK`. Never stop containers that are not part of this project.
- [ ] **Step 3:** Run `node --test infra/scripts/`, `pnpm lint` and `pnpm format:check`.
- [ ] **Step 4:** Commit `feat(infra): seed demo purchases through the gateway API`.

### Task 3: `docs/local-demo.md` — run, log in, test and demo guide

**Files:**

- Create: `docs/local-demo.md`.
- Modify: `AGENTS.md` (one line pointing to it, for the Phase 9 README link).

**Content, in this order, written for a reviewer who has never seen the repo:**

1. **What you get.** One paragraph listing the services and the web app at `http://127.0.0.1:8080`.
2. **Prerequisites.** Docker with Compose v2, Node 26 and pnpm 10.34.9 (corepack or `npm i -g pnpm@10.34.9`), with `pnpm install` once. The scripts load bcrypt from the workspace. Also about 10 GB free disk for images.
3. **Quick start.** Four commands:

   ```bash
   pnpm install
   node infra/scripts/setup-local.mjs        # writes infra/.env, prints the admin login once
   docker compose -f infra/docker-compose.yml up -d --build --wait
   infra/scripts/seed-demo.sh                # optional: real demo purchases
   ```

4. **URLs and ports.** A table:

   | What | URL | Default port | Override |
   | --- | --- | --- | --- |
   | Shop | `/` | 8080 | `WEB_HOST_PORT` |
   | Backoffice | `/backoffice` | 8080 | `WEB_HOST_PORT` |
   | Gateway API | | 3000 | `GATEWAY_HOST_PORT` |
   | Gateway Swagger | `/docs` | 3000 | `GATEWAY_HOST_PORT` |
   | Postgres | | 5432 | `POSTGRES_HOST_PORT` |

   - The internal services listen on 127.0.0.1:3001/3002/3003 for debugging only.
   - The setup script picks free ports automatically. Explain how to change them later.
5. **Backoffice login.** Where it comes from (the setup script output), `--reset-admin` (then restart the gateway), and that it is never committed or stored in plain text except as `ADMIN_PASSWORD_DEV` in the git-ignored `infra/.env` for the smoke and contract tests.
6. **Seed data.**
   - **Required, by migration:**

     | Type | Price | Quota |
     | --- | --- | --- |
     | Gold | AED 100 | 100 |
     | Premium | AED 200 | 100 |
     | VIP | AED 500 | 100 |

     Accounts: 1100 Payment Gateway Clearing and 4000 Ticket Sales Revenue.
   - **Demo purchases, from `seed-demo.sh`:** the four purchases and their effect on availability, transactions, ledger entries and balances (debit = credit = AED 1,200.00 after one seed run).
   - **Reset everything:** `docker compose -f infra/docker-compose.yml down -v`. This deletes the database volume.
7. **Test cards.**
   - Any Luhn-valid number succeeds. Show 4242 4242 4242 4242 (Visa), 5555 5555 5555 4444 (Mastercard) and 3782 822463 10005 (Amex, 15 digits). Any holder name, any future MM/YY, any 3–4 digit CVC.
   - Failure examples: 4242 4242 4242 4241 fails Luhn (inline error), and an expiry before this month is rejected.
   - The card number is never stored; only the last four digits are.
8. **QR simulation.** "QR scan" shows a QR code with a simulation payload (not UPI/QRIS). The server marks it paid about 8 s after it is created. The page polls every second and opens the receipt. "Use card instead" cancels the QR payment.
9. **Demo script.** A numbered walk-through. Each step names the challenge requirement it proves and what to point at:
   1. ticket selection with live total;
   2. checkout through the API;
   3. card success;
   4. QR success after 8 s;
   5. receipt with transaction ID, payment reference and timestamp;
   6. backoffice login;
   7. transactions;
   8. ledger entries (debit Payment Gateway Clearing, credit Ticket Sales Revenue);
   9. accounts "Balanced";
   10. ticket availability decreasing;
   11. idempotency: replaying the same `Idempotency-Key` with curl through the gateway returns the stored response with `Idempotent-Replayed: true`. Give the exact curl, with placeholders for the order id.
10. **Health and checks.**
    - `infra/scripts/smoke.sh`. Warning: it runs `down -v` and wipes the data.
    - `infra/scripts/contract.sh`.
    - `/health/ready` on the gateway.

The copy rules from the web design system apply to the prose: sentence case and plain words.

- [ ] **Step 1:** Write the guide.
  - Check every command and URL in it against the repo: the scripts exist, the flags match, and the ports match compose.
  - Run the quick start for real against a temp copy of the env: run `node infra/scripts/setup-local.mjs --env /tmp/…/.env --no-ports --password-stdin` with piped input, and confirm the output format.
  - Never run it against the real `infra/.env` with `--reset-admin` unless the controller asks.
- [ ] **Step 2:** `pnpm format:check`.
- [ ] **Step 3:** Commit `docs: local demo guide with login, seed data, test cards and demo script`.

## Execution options

**A — Claude Code subagents (Sonnet 5.5):** execute this plan with superpowers:subagent-driven-development. Task 1 handles secrets and gets an Opus reviewer.

**B — OpenCode hand-off:**

```bash
opencode run "Read AGENTS.md and docs/plans/2026-11-15-phase-7b-local-demo.md. You are on branch \
phase-7b-local-demo; do not switch branches. Execute tasks 1 to 3 in order, test first where the \
task says so, run every verification, and commit as each task says. Never read or print infra/.env \
and never print a password or API key except as Task 1 allows. Add no dependencies. Never stop \
Docker containers that are not part of this project. If a verification fails twice, stop and report."
```
