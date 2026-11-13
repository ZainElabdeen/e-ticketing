#!/usr/bin/env bash
# Creates the three service schemas with their owner and runtime roles.
#
# Runs from three places, always against an empty database:
#   - docker compose, via /docker-entrypoint-initdb.d (infra/docker-compose.yml)
#   - Testcontainers, via @eticket/testing (packages/testing/src/postgres.ts)
#   - the K3s bootstrap Job (Phase 9)
#
# Passwords arrive as environment variables and are handed to psql as
# variables, never interpolated into SQL.
set -euo pipefail

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${TICKETS_OWNER_PASSWORD:?TICKETS_OWNER_PASSWORD is required}"
: "${TICKETS_APP_PASSWORD:?TICKETS_APP_PASSWORD is required}"
: "${PAYMENTS_OWNER_PASSWORD:?PAYMENTS_OWNER_PASSWORD is required}"
: "${PAYMENTS_APP_PASSWORD:?PAYMENTS_APP_PASSWORD is required}"
: "${LEDGER_OWNER_PASSWORD:?LEDGER_OWNER_PASSWORD is required}"
: "${LEDGER_APP_PASSWORD:?LEDGER_APP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v db_name="$POSTGRES_DB" \
  -v tickets_owner_pw="$TICKETS_OWNER_PASSWORD" \
  -v tickets_app_pw="$TICKETS_APP_PASSWORD" \
  -v payments_owner_pw="$PAYMENTS_OWNER_PASSWORD" \
  -v payments_app_pw="$PAYMENTS_APP_PASSWORD" \
  -v ledger_owner_pw="$LEDGER_OWNER_PASSWORD" \
  -v ledger_app_pw="$LEDGER_APP_PASSWORD" <<'SQL'
CREATE ROLE tickets_owner LOGIN PASSWORD :'tickets_owner_pw';
CREATE ROLE tickets_app   LOGIN PASSWORD :'tickets_app_pw';
CREATE SCHEMA tickets AUTHORIZATION tickets_owner;
REVOKE ALL ON SCHEMA tickets FROM PUBLIC;
GRANT USAGE ON SCHEMA tickets TO tickets_app;
ALTER DEFAULT PRIVILEGES FOR ROLE tickets_owner IN SCHEMA tickets
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tickets_app;
ALTER ROLE tickets_owner SET search_path = tickets;
ALTER ROLE tickets_app   SET search_path = tickets;

CREATE ROLE payments_owner LOGIN PASSWORD :'payments_owner_pw';
CREATE ROLE payments_app   LOGIN PASSWORD :'payments_app_pw';
CREATE SCHEMA payments AUTHORIZATION payments_owner;
REVOKE ALL ON SCHEMA payments FROM PUBLIC;
GRANT USAGE ON SCHEMA payments TO payments_app;
ALTER DEFAULT PRIVILEGES FOR ROLE payments_owner IN SCHEMA payments
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO payments_app;
ALTER ROLE payments_owner SET search_path = payments;
ALTER ROLE payments_app   SET search_path = payments;

CREATE ROLE ledger_owner LOGIN PASSWORD :'ledger_owner_pw';
CREATE ROLE ledger_app   LOGIN PASSWORD :'ledger_app_pw';
CREATE SCHEMA ledger AUTHORIZATION ledger_owner;
REVOKE ALL ON SCHEMA ledger FROM PUBLIC;
GRANT USAGE ON SCHEMA ledger TO ledger_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ledger_owner IN SCHEMA ledger
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledger_app;
ALTER ROLE ledger_owner SET search_path = ledger;
ALTER ROLE ledger_app   SET search_path = ledger;

REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO
  tickets_owner, tickets_app,
  payments_owner, payments_app,
  ledger_owner, ledger_app;
SQL
