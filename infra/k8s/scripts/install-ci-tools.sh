#!/usr/bin/env bash
# Installs the pinned CLI tools the k8s checks need into a directory (no sudo, no curl|sh).
# Every download is verified against a sha256 pinned here before it is used.
#
#   install-ci-tools.sh <bin-dir> <kubectl|kubeconform|k3d>...
#
# linux/amd64 only (GitHub ubuntu-24.04 runners and the dev laptop). Add <bin-dir> to PATH.
set -euo pipefail

KUBECTL_VERSION=v1.37.2
KUBECTL_SHA256=c04487523e7aa7d1493f7808174c899db93d7a9cf57531420cd76b9bd415f8f4
KUBECONFORM_VERSION=v0.8.0
KUBECONFORM_SHA256=9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
K3D_VERSION=v5.9.0
K3D_SHA256=06d8f25bc3a971c4eb29e0ff08429b180402db0f4dec838c9eac427e296800a0

if [[ $# -lt 2 ]]; then
  echo "usage: install-ci-tools.sh <bin-dir> <kubectl|kubeconform|k3d>..." >&2
  exit 2
fi
bin="$1"
shift
mkdir -p "$bin"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { # url sha256 out
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | sha256sum -c - >/dev/null || {
    echo "install-ci-tools: sha256 mismatch for $1" >&2
    exit 1
  }
}

for tool in "$@"; do
  case "$tool" in
    kubectl)
      fetch "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" "$KUBECTL_SHA256" "$work/kubectl"
      install -m 755 "$work/kubectl" "$bin/kubectl"
      ;;
    kubeconform)
      fetch "https://github.com/yannh/kubeconform/releases/download/${KUBECONFORM_VERSION}/kubeconform-linux-amd64.tar.gz" \
        "$KUBECONFORM_SHA256" "$work/kubeconform.tgz"
      mkdir "$work/kc"
      tar -xzf "$work/kubeconform.tgz" -C "$work/kc" kubeconform
      install -m 755 "$work/kc/kubeconform" "$bin/kubeconform"
      ;;
    k3d)
      fetch "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64" "$K3D_SHA256" "$work/k3d"
      install -m 755 "$work/k3d" "$bin/k3d"
      ;;
    *)
      echo "install-ci-tools: unknown tool $tool" >&2
      exit 2
      ;;
  esac
  echo "install-ci-tools: $tool installed in $bin"
done
