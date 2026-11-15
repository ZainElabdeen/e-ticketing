#!/usr/bin/env bash
# Runs a black-box contract suite against the compose stack.
# Usage: infra/scripts/contract.sh <ticket|payment|ledger|gateway> [ticketBaseUrl]
# Keys come from infra/.env through `node --env-file` (no shell sourcing).
# `node --env-file` does not expand `$`, but compose does interpolate `$` in
# infra/.env, so a key must not contain `$`; generated hex keys never do.
set -euo pipefail
cd "$(dirname "$0")/../.."
# The suites load the bundled OpenAPI JSON (@eticket/contracts/openapi/*.json ->
# packages/contracts/dist). A fresh checkout has no dist/, so bundle first.
pnpm --silent --filter @eticket/contracts bundle >/dev/null
exec node --env-file=infra/.env infra/scripts/contract.mjs "$@"
