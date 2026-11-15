# Local demo guide

How to run the e-ticketing platform on your machine, log in to the backoffice, use the seed data and the test cards, and walk through every requirement in `docs/challenge.md`.

## What you get

Docker Compose starts PostgreSQL, three NestJS services (Ticket, Payment and Ledger), the gateway (the only public API) and the web app. The web app is a React single-page app served by nginx at `http://127.0.0.1:8080`. It holds the shop, the checkout and the backoffice. Everything binds to `127.0.0.1`, so nothing is reachable from other machines.

## Prerequisites

- Docker with Compose v2, and about 10 GB of free disk for images.
- Node 26 and pnpm 10.34.9 (`corepack enable`, or `npm i -g pnpm@10.34.9`).
- Run `pnpm install` once. The setup script loads `bcryptjs` from the workspace, so it will not run without it.

## Quick start

From the repository root:

```bash
pnpm install
node infra/scripts/setup-local.mjs        # writes infra/.env, prints the admin login once
docker compose -f infra/docker-compose.yml up -d --build --wait
infra/scripts/seed-demo.sh                # optional: real demo purchases
```

What each step does:

1. `setup-local.mjs` creates `infra/.env` (mode 600, git-ignored). It generates every password, API key and the JWT secret, picks free host ports, and sets the backoffice login.
2. `docker compose ... up --build --wait` builds the images and returns when every service is healthy. The first build takes a few minutes.
3. `seed-demo.sh` makes four real purchases through the gateway so the backoffice is not empty. See [Seed data](#seed-data).

Then open `http://127.0.0.1:8080` (or the port the script chose, see below).

## URLs and ports

| What        | URL      | Default port | Override             |
| ----------- | -------- | ------------ | -------------------- |
| Shop        | `/`      | 8080         | `WEB_HOST_PORT`      |
| Backoffice  | `/backoffice` | 8080    | `WEB_HOST_PORT`      |
| Gateway API |          | 3000         | `GATEWAY_HOST_PORT`  |
| Gateway Swagger | `/docs` | 3000      | `GATEWAY_HOST_PORT`  |
| Postgres    |          | 5432         | `POSTGRES_HOST_PORT` |

- All URLs use host `127.0.0.1`, for example `http://127.0.0.1:3000/docs`.
- The Ticket, Payment and Ledger services also listen on `127.0.0.1:3001`, `3002` and `3003`. This is for debugging only. They need internal API keys, and the browser never uses them.
- On a new `infra/.env`, the setup script checks each default port and picks the next free one (default + 100 and up) if it is busy. It prints a line such as `Port 3000 is busy; gateway will use 3100`.
- To change a port later, set the variable in `infra/.env` (`WEB_HOST_PORT=8081`) and run `docker compose -f infra/docker-compose.yml up -d`. The scripts (`seed-demo.sh`, `smoke.sh`, `contract.sh`) read the same file, so they follow the change.

## Backoffice login

- The login is created by `setup-local.mjs` and printed once, in the terminal where you ran it. Default email: `admin@eticket.local`.
- If stdout is not a terminal (for example a pipe), the generated password is written to `infra/.admin-login.txt` (mode 600, git-ignored) and the script prints that path. Delete the file once you have stored the password.
- Only a bcrypt hash of the password goes to the gateway. The plain password is never committed. The one place it exists in plain text is `ADMIN_PASSWORD_DEV` in the git-ignored `infra/.env`, which the smoke and contract tests use to log in.
- Running the setup script again keeps all existing values and says `Admin login unchanged`.
- To set a new login, run `node infra/scripts/setup-local.mjs --reset-admin` (add `--email you@example.com` or `--password-stdin` if you want to choose them), then restart the gateway so it reads the new hash:

  ```bash
  docker compose -f infra/docker-compose.yml up -d gateway
  ```

## Seed data

### Required data (created by migrations)

The database migrations insert these rows. They exist on every fresh database, with or without `seed-demo.sh`.

| Type    | Code      | Price   | Quota |
| ------- | --------- | ------- | ----- |
| Gold    | `GOLD`    | AED 100 | 100   |
| Premium | `PREMIUM` | AED 200 | 100   |
| VIP     | `VIP`     | AED 500 | 100   |

Ledger accounts:

| Code   | Name                     | Type      |
| ------ | ------------------------ | --------- |
| `1100` | Payment Gateway Clearing | Asset     |
| `4000` | Ticket Sales Revenue     | Revenue   |

The migration also creates account `2100` Customer Refunds Payable (liability). Nothing posts to it in this build.

### Demo purchases (`seed-demo.sh`)

The script uses only the public gateway API, like the browser does. It makes four purchases and waits for each order to be confirmed:

| #   | Tickets             | Method                 | Total   |
| --- | ------------------- | ---------------------- | ------- |
| 1   | Gold x 2            | Card (Visa, 4242)      | AED 200 |
| 2   | Premium x 1         | Card (Mastercard, 4444) | AED 200 |
| 3   | VIP x 1             | QR (paid after 8 s)    | AED 500 |
| 4   | Gold x 1, Premium x 1 | Card (Visa, 4242)    | AED 300 |

After one run:

- 6 tickets are sold, AED 1,200.00 in total. Availability: Gold 97, Premium 98, VIP 99.
- The backoffice shows 4 transactions and 4 ledger entries.
- Account balances: Payment Gateway Clearing debit AED 1,200.00, Ticket Sales Revenue credit AED 1,200.00. Totals are equal, so the page shows "Balanced".

Notes:

- Each run buys again. It is not idempotent and uses quota, so run it once (quota is 100 per type).
- `infra/scripts/seed-demo.sh --dry-run` prints the plan and sends nothing.
- It stops with `SEED FAILED: ...` if the gateway does not answer or the target is not the gateway. On a rate limit (HTTP 429) it waits for `Retry-After` and retries.

### Reset everything

```bash
docker compose -f infra/docker-compose.yml down -v
```

This deletes the database volume: all orders, payments, transactions and ledger entries. The next `up` recreates the schema and the required data above. `infra/.env` is not touched.

## Test cards

The payment simulation accepts any card number that passes the Luhn check.

| Card       | Number                | Result  |
| ---------- | --------------------- | ------- |
| Visa       | `4242 4242 4242 4242` | Success |
| Mastercard | `5555 5555 5555 4444` | Success |
| Amex (15 digits) | `3782 822463 10005` | Success |
| Fails Luhn | `4242 4242 4242 4241` | Inline error "Check the card number" |

For the other fields use any name, any expiry that is not before this month (format `MM/YY`, for example `12/30`) and any 3 or 4 digit security code.

An expiry date before the current month is rejected with "Card has expired".

The card number is never stored. The service keeps only the last four digits, and the receipt shows "Card ending 4242".

## QR simulation

Choose "QR scan" at checkout. The page shows a QR code. Its content is a simulation payload, not a real UPI or QRIS payment. The server marks the payment as paid about 8 seconds after it was created. The page asks the gateway for the payment status every second and opens the receipt when it succeeds. You do not need to scan anything.

"Use card instead" cancels the pending QR payment and returns to checkout, where you can pay by card.

## Demo script

Run this after `seed-demo.sh`, or on an empty database. Each step names the requirement from `docs/challenge.md` it proves.

1. **Ticket selection with a live total.** Open `http://127.0.0.1:8080`. Use the steppers on Gold, Premium and VIP. *Proves: three ticket types, total calculated.* Point at the prices (AED 100, 200, 500) and the total changing as you add tickets. The server recalculates the total when the order is created. The client never sets a price.
2. **Checkout through the API.** Select tickets and continue. *Proves: checkout page reached through an API.* Point at the order page: the browser called `POST /v1/orders` on the gateway, which reserved the quota and returned a pending order that is valid for 15 minutes (the countdown).
3. **Card success.** Pay with `4242 4242 4242 4242`, any name, expiry `12/30`, CVC `123`. *Proves: credit card, a valid number succeeds.* Try `4242 4242 4242 4241` first to show the Luhn error.
4. **QR success after 8 seconds.** Start a new order, choose "QR scan". *Proves: QR method, 8 s delay.* Point at the QR code and "Waiting for payment…". After about 8 seconds the page moves to the receipt by itself.
5. **Receipt.** *Proves: transaction ID, payment reference, timestamp.* The "Payment received" page shows Transaction ID, Payment reference and Time, plus "Paid with" and the order id.
6. **Backoffice login.** Open `http://127.0.0.1:8080/backoffice`. It redirects to the login page. Sign in with the email and password from setup. *Proves: simple authentication.* The gateway issues a one-hour JWT. Without it, the backoffice API answers 401.
7. **Transactions.** Open the "Transactions" tab. *Proves: view transactions.* Point at the purchase you just made: payment reference, transaction ID, order, method, amount.
8. **Ledger entries.** Open "Ledger entries". *Proves: ledger entries, double entry.* Each entry has two lines: a debit to Payment Gateway Clearing (1100) and a credit to Ticket Sales Revenue (4000), for the same amount. Entries are append-only, and a transaction can post only one entry.
9. **Accounts "Balanced".** Open "Account balances". *Proves: debits equal credits.* Total debit equals total credit and the page shows "Balanced".
10. **Ticket availability.** Open "Ticket availability", then buy another ticket and reload the tab. *Proves: view ticket availability, quota.* The columns are Price, Quota, Sold, Reserved and Available. Available for that type drops by the quantity bought. Sold plus reserved never exceeds the quota of 100.
11. **Idempotency.** Send the same payment twice with the same `Idempotency-Key`. *Proves: safe retries (production-minded).* The second response is the stored first response with `Idempotent-Replayed: true`, and no second payment is made.

    Create a one-ticket order. This uses 1 Gold ticket:

    ```bash
    GATEWAY=http://127.0.0.1:${GATEWAY_HOST_PORT:-3000}
    curl -s -X POST "$GATEWAY/v1/orders" \
      -H 'content-type: application/json' \
      -d '{"items":[{"ticketTypeCode":"GOLD","quantity":1}]}'
    # copy the "id" from the response
    ```

    Pay it, twice, with the same key (replace `<ORDER_ID>` and `<KEY>`, where `<KEY>` is any string of 8 to 128 characters, for example a UUID):

    ```bash
    for i in 1 2; do
      curl -s -i -X POST "$GATEWAY/v1/payments" \
        -H 'content-type: application/json' \
        -H 'Idempotency-Key: <KEY>' \
        -d '{"orderId":"<ORDER_ID>","method":"CARD","card":{"number":"4242424242424242","expMonth":12,"expYear":2030,"cvc":"123","holder":"Demo Visa"}}' \
        | grep -i -E '^HTTP|^idempotent-replayed|^\{'
    done
    ```

    Both calls return `201` with the same payment `id`. Only the second has the header:

    ```text
    HTTP/1.1 201 Created
    {"id":"...","status":"SUCCEEDED", ...}
    HTTP/1.1 201 Created
    idempotent-replayed: true
    {"id":"...","status":"SUCCEEDED", ...}
    ```

    If `GATEWAY_HOST_PORT` is set in `infra/.env` (the setup script may have chosen a port such as 3100), use that value in the first line. Reusing the same key with a different body returns `422` (`IDEMPOTENCY_KEY_REUSE`).

## Health and checks

- Gateway readiness: `curl http://127.0.0.1:${GATEWAY_HOST_PORT:-3000}/health/ready`. It checks the downstream services. `/health/live` only checks the gateway process.
- Smoke test: `infra/scripts/smoke.sh`. It starts a fresh stack, buys by card and by QR through the gateway, checks the ledger balance and the web origin, and ends with `SMOKE OK`. **Warning: it runs `docker compose down -v` before and after, so it deletes all local database data.** Add `--keep` to leave the stack running afterwards (the data is still wiped before the run).
- Contract suites: `infra/scripts/contract.sh <ticket|payment|ledger|gateway>` runs black-box API tests against the running stack, using the keys in `infra/.env`. Run `ticket` before `payment`, because the ticket suite drains the VIP quota, so a later demo cannot buy VIP until you reset. It adds orders and payments but does not delete data.
- Stop the stack and keep the data: `docker compose -f infra/docker-compose.yml down`.
