# Infra (compose, images, DB bootstrap, scripts)

Local run guide: `docs/local-demo.md`. Commands: root `AGENTS.md`.

## Safety

- `smoke.sh` runs `docker compose down -v` before and after (unless `--keep`):
  it destroys the local DB volume. Ask before running it on a stack holding
  data you need.
- Other projects share this Docker host. Prune only the build cache, and only
  with the user's approval; never prune images or volumes, never stop
  containers this compose file does not own.
- `infra/.env` holds real secrets: reference key names only, never read or print
  values. Scripts load it with `node --env-file`, never shell `source`.

## Compose

- Host ports: ticket 3001 (.NET), ticket-service-node 3011, payment 3002, ledger 3003, gateway
  `${GATEWAY_HOST_PORT:-3000}`, web `${WEB_HOST_PORT:-8080}`, postgres
  `${POSTGRES_HOST_PORT:-5432}`. All bind to 127.0.0.1. `contract.mjs` hardcodes
  3001–3003.
- Secrets are `${VAR:?msg}`; a `$` in a value is interpolated by compose but not
  by `node --env-file`, so keys contain no `$`. DB owner passwords go unencoded
  into URLs, so keep them URL-safe.
- `RATE_LIMIT_WINDOW_MS` is test-only; it never goes in compose.

## Postgres bootstrap

- `postgres/init/00-roles.sh` runs only on an empty volume (after a password
  change: `down -v`). It is shared by compose, Testcontainers
  (`packages/testing`) and the future K3s bootstrap, so it stays env-driven.
- One owner role (migrations) and one app role (runtime) per schema; PUBLIC is
  revoked. Default privileges cover tables only, so a migration adding a
  sequence must grant it.
- Migrations run in the `migrate` image; `PRISMA_VERSION` there is a manual copy
  of the apps' Prisma pin.

## Images

- Three Dockerfiles (`nest-service`, `web`, `dotnet-ticket`) copy every
  workspace `package.json` before install. A new workspace package means adding
  its line to all three, or `--frozen-lockfile` fails.
- pnpm is installed with `npm i -g pnpm@<version>` (Node 26 ships no corepack);
  keep it equal to `packageManager` in the root `package.json`.

## nginx

- `add_header` inside a `location` drops server-level headers, so every location
  includes `docker/nginx-security-headers.conf`.
- nginx sets `X-Forwarded-For: $remote_addr`; locally `TRUST_PROXY` is 0.
