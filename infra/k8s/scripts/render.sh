#!/usr/bin/env bash
# Prints the rendered manifests of an overlay on stdout.
#
#   render.sh local            infra/k8s/overlays/local
#   render.sh prod             infra/k8s/overlays/prod (needs the generated, git-ignored
#                              kustomization.yaml; see render-prod.mjs)
#   render.sh <directory>      any kustomization directory, e.g. infra/k8s/.rendered/<name>
#                              (must sit two levels below infra/k8s so ../../base resolves)
#
# --load-restrictor LoadRestrictionsNone is required: the base reads
# infra/postgres/init/00-roles.sh, the single source shared with compose.
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: render.sh <local|prod|directory>" >&2
  exit 2
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$1" in
  local | prod) dir="$here/overlays/$1" ;;
  *) dir="$1" ;;
esac

if [ ! -f "$dir/kustomization.yaml" ]; then
  echo "render.sh: no kustomization.yaml in $dir" >&2
  exit 1
fi

exec kubectl kustomize --load-restrictor LoadRestrictionsNone "$dir"
