#!/usr/bin/env bash
# Runs a black-box contract suite against the compose stack.
# Usage: infra/scripts/contract.sh <ticket|payment|ledger> [ticketBaseUrl]
# Keys come from infra/.env through `node --env-file` (no shell sourcing, so a
# `$` in a value cannot break it).
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --env-file=infra/.env infra/scripts/contract.mjs "$@"
