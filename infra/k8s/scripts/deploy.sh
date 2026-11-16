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
if [[ $# -eq 2 && "$2" == "--dry-run" ]]; then
  dry_run=1
elif [[ $# -ne 1 ]]; then
  echo "usage: deploy.sh <sha-tag> [--dry-run]" >&2
  exit 2
fi
if [[ ! "$tag" =~ ^sha-[0-9a-f]{7}$ ]]; then
  echo "deploy: tag must look like sha-0123abc (sha- plus 7 lowercase hex digits)" >&2
  exit 2
fi
# A non-interactive SSH shell (CD) does not load nvm, so fail early and say what is missing.
need=(node)
[[ "$dry_run" -eq 1 ]] || need+=(kubectl)
for cmd in "${need[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "deploy: $cmd is not on PATH for this (possibly non-interactive) shell; install it system-wide (see infra/k8s/README.md)" >&2
    exit 1
  fi
done
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
trap 'rm -rf "$rendered"' EXIT

if [[ "$dry_run" -eq 0 ]]; then
  echo "deploy: checking the eight images have $tag on GHCR"
  node "$here/ghcr.mjs" check "$tag"
  "$here/apply-secrets.sh"
fi

node "$here/render-prod.mjs" --target prod --host "$host" --tag "$tag"
"$here/render.sh" prod >"$rendered"

# Expected workloads come from the rendered YAML; an empty list fails before any apply.
workloads="$(node "$here/ghcr.mjs" workloads <"$rendered")"

if [[ "$dry_run" -eq 1 ]]; then
  node "$here/ghcr.mjs" kinds <"$rendered"
  echo "DEPLOY DRY-RUN $tag"
  exit 0
fi

kubectl apply -f "$rendered"

if ! kubectl -n kube-system get helmchartconfig traefik >/dev/null 2>&1; then
  echo "deploy: hint: Traefik HelmChartConfig not applied yet (one-time VM step, see infra/k8s/README.md)" >&2
fi

# The HelmChartConfig is copied by hand (one-time step); remind the operator when the repo's version differs.
# Advisory only: every failure here is swallowed so it can never abort before the rollout check.
traefik_hint() {
  local vm_traefik=/var/lib/rancher/k3s/server/manifests/traefik-config.yaml
  if [[ ! -r "$vm_traefik" ]]; then
    echo "deploy: reminder: if infra/k8s/traefik/helmchartconfig.yaml changed, re-copy it to $vm_traefik (infra/k8s/README.md, Upgrade)" >&2
    return 0
  fi
  local acme_email
  acme_email="$(node --env-file="$env_file" -e 'process.stdout.write(process.env.ACME_EMAIL ?? "")')" || return 0
  [[ -n "$acme_email" ]] || return 0
  if ! node "$here/render-prod.mjs" --traefik --acme-email "$acme_email" >/dev/null 2>&1; then
    echo "deploy: note: could not render the Traefik config; drift hint skipped" >&2
    return 0
  fi
  if ! cmp -s "$here/../.rendered/traefik-config.yaml" "$vm_traefik"; then
    echo "deploy: hint: infra/k8s/traefik/helmchartconfig.yaml differs from $vm_traefik; re-render and copy it (infra/k8s/README.md, Upgrade)" >&2
  fi
}
traefik_hint || true

for workload in $workloads; do
  kubectl -n "$namespace" rollout status "$workload" --timeout=300s
done

echo "DEPLOY OK $tag"
