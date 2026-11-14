#!/usr/bin/env bash
# End-to-end smoke test: boots the three services on a fresh volume, buys a
# ticket by card and by QR, and checks the ledger is balanced.
# WARNING: this DESTROYS the local compose volume (`docker compose down -v`),
# so all local database data is lost, before the run and again on teardown.
# Usage: infra/scripts/smoke.sh [--keep]   (--keep leaves the stack running)
set -euo pipefail
cd "$(dirname "$0")/../.."
compose=(docker compose -f infra/docker-compose.yml)

keep=false
case "${1:-}" in
  "") ;;
  --keep) keep=true ;;
  *)
    echo "usage: infra/scripts/smoke.sh [--keep]" >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "usage: infra/scripts/smoke.sh [--keep]" >&2
  exit 2
fi

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ "$keep" = false ]; then
    "${compose[@]}" logs --no-color --tail=200 || true
  fi
  if [ "$keep" = false ]; then
    "${compose[@]}" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

"${compose[@]}" down -v
"${compose[@]}" up -d --build --wait ticket-service payment-service ledger-service

# Node's own parser reads the file: no shell sourcing, so no `$` expansion or
# command substitution from a password value. docker compose reads infra/.env itself.
node --env-file=infra/.env infra/scripts/smoke.mjs
