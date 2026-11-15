#!/usr/bin/env bash
# Makes real demo purchases (card and QR) through the gateway so the backoffice has data.
# Usage: infra/scripts/seed-demo.sh [--dry-run]. The stack must be up.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node --env-file=infra/.env infra/scripts/seed-demo.mjs "$@"
