# contract-tests

Black-box contract suites for the Ticket, Payment and Ledger Services and the Gateway. It checks the public and
internal HTTP API against the bundled OpenAPI contract
(`@eticket/contracts`, validated with Ajv): health, API-key scopes, ticket
types, order creation and quota, order lookup, confirmation, and the error
envelope. The ASP.NET Core port must pass the identical suite.

## Two runners

1. In-process, from the Ticket Service integration tests
   (`pnpm --filter @eticket/ticket-service test:int`): the app starts on a
   Testcontainers Postgres and the suite runs through `runTicketServiceContract`.
2. Against any running base URL (compose, K3s, the .NET port):

   ```bash
   CONTRACT_BASE_URL=http://127.0.0.1:3001 \
   CONTRACT_API_KEY=<public key> \
   CONTRACT_INTERNAL_API_KEY=<internal key> \
   pnpm --filter @eticket/contract-tests test:contract:ticket
   ```

Both Ticket Service implementations (the ASP.NET Core one on `:3001` and the
NestJS reference under the compose `reference` profile on `:3011`) must pass
the identical suite. With the compose stack up, `infra/scripts/contract.sh`
reads the keys from `infra/.env` and runs a suite:

```bash
infra/scripts/contract.sh ticket                        # .NET, http://127.0.0.1:3001
infra/scripts/contract.sh ticket http://127.0.0.1:3011  # NestJS reference
infra/scripts/contract.sh payment
infra/scripts/contract.sh ledger
```

## Environment variables

| Variable                     | Required | Meaning                                                  |
| ---------------------------- | -------- | -------------------------------------------------------- |
| `CONTRACT_BASE_URL`          | yes      | Target base URL, no trailing path                        |
| `CONTRACT_API_KEY`           | yes      | The target's public API key                              |
| `CONTRACT_INTERNAL_API_KEY`  | yes      | The target's internal API key                            |
| `CONTRACT_ORDER_TTL_MINUTES` | no       | The target's order TTL; defaults to 15 (matches compose) |

## Payment Service area

`test:contract:payment` checks the Payment Service: health, API-key scope,
card and QR payments, idempotency, cancel, the transaction list, and the error
envelope. It needs a running Ticket Service too, because it creates orders
there (GOLD) and then pays them. Run the ticket suite first (it drains VIP).

```bash
CONTRACT_PAYMENT_BASE_URL=http://127.0.0.1:3002 \
CONTRACT_PAYMENT_API_KEY=<payment public key> \
CONTRACT_TICKET_BASE_URL=http://127.0.0.1:3001 \
CONTRACT_TICKET_API_KEY=<ticket public key> \
CONTRACT_QR_DELAY_SECONDS=8 \
pnpm --filter @eticket/contract-tests test:contract:payment
```

| Variable                    | Required | Meaning                                                |
| --------------------------- | -------- | ------------------------------------------------------ |
| `CONTRACT_PAYMENT_BASE_URL` | yes      | Payment Service base URL                               |
| `CONTRACT_PAYMENT_API_KEY`  | yes      | The Payment Service public API key                     |
| `CONTRACT_TICKET_BASE_URL`  | yes      | Ticket Service base URL (orders are created here)      |
| `CONTRACT_TICKET_API_KEY`   | yes      | The Ticket Service public API key                      |
| `CONTRACT_QR_DELAY_SECONDS` | no       | The target's `QR_SUCCESS_DELAY_SECONDS`; defaults to 8 |

## Ledger Service area

`test:contract:ledger` checks the Ledger Service: health, API-key scopes
(the public key is refused on `/v1/internal/*`), idempotent double-entry
postings, conflict detection, journal entries, account balances, and the error
envelope. It needs only the Ledger Service.

```bash
CONTRACT_LEDGER_BASE_URL=http://127.0.0.1:3003 \
CONTRACT_LEDGER_API_KEY=<ledger public key> \
CONTRACT_LEDGER_INTERNAL_API_KEY=<ledger internal key> \
pnpm --filter @eticket/contract-tests test:contract:ledger
```

| Variable                           | Required | Meaning                             |
| ---------------------------------- | -------- | ----------------------------------- |
| `CONTRACT_LEDGER_BASE_URL`         | yes      | Ledger Service base URL             |
| `CONTRACT_LEDGER_API_KEY`          | yes      | The Ledger Service public API key   |
| `CONTRACT_LEDGER_INTERNAL_API_KEY` | yes      | The Ledger Service internal API key |

## Gateway area

`test:contract:gateway` checks the public edge: health, the shop routes
(ticket types, order, card payment with an idempotent replay, payment lookup),
backoffice login and the four JWT-protected routes, and the allow-list (internal
and unscoped paths answer 404). It needs the whole stack behind the Gateway.
It talks only to the Gateway and holds no service key.

The suite fits inside the production rate limits in one run (2 order
creations of the 5/min limit, 3 logins of 10/min, about 23 requests of 100/min),
so it runs against compose with default limits. Keep it that way: it shares one
JWT across the backoffice tests. Run it after the ticket, payment and ledger
suites, or before the ticket suite drains VIP: its orders use GOLD.

```bash
CONTRACT_GATEWAY_BASE_URL=http://127.0.0.1:3000 \
CONTRACT_ADMIN_EMAIL=<admin email> \
CONTRACT_ADMIN_PASSWORD=<admin password> \
pnpm --filter @eticket/contract-tests test:contract:gateway
```

| Variable                    | Required | Meaning                                             |
| --------------------------- | -------- | --------------------------------------------------- |
| `CONTRACT_GATEWAY_BASE_URL` | yes      | Gateway base URL                                    |
| `CONTRACT_ADMIN_EMAIL`      | yes      | The configured `ADMIN_EMAIL`                        |
| `CONTRACT_ADMIN_PASSWORD`   | yes      | The plaintext password whose hash the Gateway holds |

`infra/scripts/contract.sh gateway` maps these from `infra/.env`
(`ADMIN_EMAIL` and `ADMIN_PASSWORD_DEV`).

`test:contract` runs all four suites, so it needs the ticket, payment, ledger and gateway variables. Run the suites in order ticket → payment → ledger → gateway on a fresh volume.

## Warning: the suite mutates the target

It reserves quota, confirms orders and drains VIP; the payment suite also creates orders and payments on its target. It therefore cannot be
re-run against the same persistent target until the orders expire (about 15
minutes) or the database is reset
(`docker compose -f infra/docker-compose.yml down -v`).
