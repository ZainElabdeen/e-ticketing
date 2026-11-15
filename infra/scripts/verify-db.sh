#!/usr/bin/env bash
# Boots Postgres, applies every service's migrations twice (the second run must
# be a no-op) and checks the seeds and the migration bookkeeping.
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --build --wait postgres

for app in tickets payments ledger; do
  echo "==> migrate-$app (first run)"
  docker compose run --rm "migrate-$app"
  echo "==> migrate-$app (second run must be a no-op)"
  docker compose run --rm "migrate-$app"
done

check() {
  local description="$1" sql="$2" expected="$3" actual
  actual=$(docker compose exec -T postgres psql -U postgres -d eticketing -tAc "$sql")
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $description: expected '$expected', got '$actual'" >&2
    exit 1
  fi
}

check 'ticket types seeded' 'SELECT count(*) FROM tickets.ticket_types' '3'
check 'ledger accounts seeded' 'SELECT count(*) FROM ledger.accounts' '3'
for pair in tickets:ticket-service payments:payment-service ledger:ledger-service; do
  schema="${pair%%:*}"
  service="${pair##*:}"
  expected=$(find "../apps/$service/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  check "$schema migrations finished (one per directory on disk)" \
    "SELECT count(*) FROM $schema._prisma_migrations WHERE finished_at IS NOT NULL" "$expected"
  check "$schema has no unfinished migration" \
    "SELECT count(*) FROM $schema._prisma_migrations WHERE finished_at IS NULL" '0'
done

echo 'DB OK'
