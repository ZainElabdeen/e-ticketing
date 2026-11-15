#!/usr/bin/env bash
# Deploys the prod overlay at one image tag to the K3s cluster kubectl points at.
#
#   deploy.sh <sha-tag> [--dry-run]
#
# Reads HOST (and ACME_EMAIL for the one-time Traefik step) from infra/k8s/.env, or from
# $K8S_ENV_FILE. Needs node and kubectl (no Docker, no curl). --dry-run validates, renders and
# prints the resource kinds/names; it checks no registry and applies nothing.
# Order: tag -> images exist on GHCR -> secrets -> render -> apply -> rollout -> DEPLOY OK.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${K8S_ENV_FILE:-$here/../.env}"
namespace=eticketing
tag="${1:-}"
dry_run=0
[[ "${2:-}" == "--dry-run" ]] && dry_run=1

if [[ -z "$tag" || ( $# -gt 1 && "$dry_run" -eq 0 ) || $# -gt 2 ]]; then
  echo "usage: deploy.sh <sha-tag> [--dry-run]" >&2
  exit 2
fi
if [[ ! "$tag" =~ ^sha-[0-9a-f]{7}$ ]]; then
  echo "deploy: tag must look like sha-0123abc (sha- plus 7 lowercase hex digits)" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  echo "deploy: $env_file not found (run: node infra/scripts/setup-local.mjs --env infra/k8s/.env, then add HOST and ACME_EMAIL)" >&2
  exit 1
fi

host="$(node --env-file="$env_file" -e 'process.stdout.write(process.env.HOST ?? "")')"
if [[ -z "$host" ]]; then
  echo "deploy: HOST is not set in $env_file" >&2
  exit 1
fi

rendered="$(mktemp)"
trap 'rm -f "$rendered"' EXIT

if [[ "$dry_run" -eq 0 ]]; then
  echo "deploy: checking the eight images have $tag on GHCR"
  node "$here/ghcr.mjs" check "$tag"
  "$here/apply-secrets.sh"
fi

node "$here/render-prod.mjs" --host "$host" --tag "$tag" --out "$here/../overlays/prod"
"$here/render.sh" prod >"$rendered"

if [[ "$dry_run" -eq 1 ]]; then
  node "$here/ghcr.mjs" kinds <"$rendered"
  echo "DEPLOY DRY-RUN $tag"
  exit 0
fi

kubectl apply -f "$rendered"

if ! kubectl -n kube-system get helmchartconfig traefik >/dev/null 2>&1; then
  echo "deploy: hint: Traefik HelmChartConfig not applied yet (one-time VM step, see infra/k8s/README.md)" >&2
fi

while IFS= read -r workload; do
  kubectl -n "$namespace" rollout status "$workload" --timeout=300s
done < <(kubectl -n "$namespace" get deployments,statefulsets -o name)

echo "DEPLOY OK $tag"
