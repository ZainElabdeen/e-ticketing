#!/usr/bin/env bash
# End-to-end smoke test: boots the three services on a fresh volume, buys a
# ticket by card and by QR, and checks the ledger is balanced.
# Usage: infra/scripts/smoke.sh [--keep]   (--keep leaves the stack running)
set -euo pipefail
cd "$(dirname "$0")/../.."
compose=(docker compose -f infra/docker-compose.yml)

keep=false
[ "${1:-}" = "--keep" ] && keep=true

cleanup() {
  if [ "$keep" = false ]; then
    "${compose[@]}" down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

"${compose[@]}" down -v
"${compose[@]}" up -d --build --wait ticket-service payment-service ledger-service

set -a
# shellcheck disable=SC1091
. infra/.env
set +a

node infra/scripts/smoke.mjs
