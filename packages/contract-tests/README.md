# contract-tests

Black-box contract suite for the Ticket Service. It checks the public and
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
   pnpm --filter @eticket/contract-tests test:contract
   ```

## Environment variables

| Variable                     | Required | Meaning                                                  |
| ---------------------------- | -------- | -------------------------------------------------------- |
| `CONTRACT_BASE_URL`          | yes      | Target base URL, no trailing path                        |
| `CONTRACT_API_KEY`           | yes      | The target's public API key                              |
| `CONTRACT_INTERNAL_API_KEY`  | yes      | The target's internal API key                            |
| `CONTRACT_ORDER_TTL_MINUTES` | no       | The target's order TTL; defaults to 15 (matches compose) |

## Warning: the suite mutates the target

It reserves quota, confirms orders and drains VIP. It therefore cannot be
re-run against the same persistent target until the orders expire (about 15
minutes) or the database is reset
(`docker compose -f infra/docker-compose.yml down -v`).
