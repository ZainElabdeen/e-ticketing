# contract-tests

Black-box contract suites for the Ticket Service and the Payment Service. It checks the public and
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

`test:contract` runs both suites and needs every variable above.

## Warning: the suite mutates the target

It reserves quota, confirms orders and drains VIP; the payment suite also creates orders and payments on its target. It therefore cannot be
re-run against the same persistent target until the orders expire (about 15
minutes) or the database is reset
(`docker compose -f infra/docker-compose.yml down -v`).
