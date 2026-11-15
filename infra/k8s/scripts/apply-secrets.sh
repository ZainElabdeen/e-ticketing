#!/usr/bin/env bash
# Creates or updates the eticket-secrets Secret from infra/k8s/.env (allow-listed keys only).
#
#   apply-secrets.sh            reads infra/k8s/.env (or $K8S_ENV_FILE)
#   apply-secrets.sh --dry-run  validates and prints the key names, applies nothing
#
# Values are never printed. HOST, ACME_EMAIL, ADMIN_PASSWORD_DEV and any other key
# stay out of the cluster (see secret-filter.mjs).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${K8S_ENV_FILE:-$here/../.env}"
namespace=eticketing
dry_run=0

if [[ "${1:-}" == "--dry-run" ]]; then
  dry_run=1
elif [[ $# -gt 0 ]]; then
  echo "usage: apply-secrets.sh [--dry-run]" >&2
  exit 2
fi

if [[ ! -f "$env_file" ]]; then
  echo "apply-secrets: $env_file not found (run: node infra/scripts/setup-local.mjs --env infra/k8s/.env)" >&2
  exit 1
fi

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

node "$here/secret-filter.mjs" "$env_file" "$tmp"

if [[ "$dry_run" -eq 1 ]]; then
  echo "apply-secrets: ok, would apply keys:"
  cut -d= -f1 "$tmp" | sed 's/^/  /'
  exit 0
fi

kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
# Server-side apply keeps Secret data out of the last-applied-configuration annotation.
kubectl create secret generic eticket-secrets -n "$namespace" \
  --from-env-file="$tmp" --dry-run=client -o yaml \
  | kubectl apply --server-side --force-conflicts --field-manager=eticket-deploy -f - >/dev/null
echo "apply-secrets: eticket-secrets applied in namespace $namespace"
