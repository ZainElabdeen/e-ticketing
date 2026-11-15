#!/usr/bin/env bash
# Renders the local overlay, a sample prod overlay and the Traefik HelmChartConfig,
# then validates them with kubeconform -strict (Kubernetes schemas for
# KUBERNETES_VERSION, Traefik and K3s CRDs from the datreeio CRDs-catalog pinned
# to one commit). Needs kubectl and kubeconform on PATH and network access to
# raw.githubusercontent.com. Exits non-zero on any invalid resource.
set -euo pipefail

KUBERNETES_VERSION="${KUBERNETES_VERSION:-1.37.2}"
CRDS_CATALOG_COMMIT="89c736bdde38b5fecd0f8436ec5f3aa3679a3b86"
CRDS_SCHEMA="https://raw.githubusercontent.com/datreeio/CRDs-catalog/${CRDS_CATALOG_COMMIT}/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$here/.rendered/validate-$$"
out="$(mktemp -d)"
trap 'rm -rf "$work" "$out"' EXIT
mkdir -p "$work"

node "$here/scripts/render-prod.mjs" --host demo.example.org --tag sha-abc1234 --out "$work" \
  --acme-email ops@example.org --traefik-out "$out/traefik.yaml"
"$here/scripts/render.sh" local >"$out/local.yaml"
"$here/scripts/render.sh" "$work" >"$out/prod.yaml"

kubeconform -strict -summary -kubernetes-version "$KUBERNETES_VERSION" \
  -schema-location default -schema-location "$CRDS_SCHEMA" \
  "$out/local.yaml" "$out/prod.yaml" "$out/traefik.yaml"
