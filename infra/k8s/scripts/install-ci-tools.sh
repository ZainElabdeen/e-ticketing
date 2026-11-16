#!/usr/bin/env bash
# Installs the pinned CLI tools the k8s checks need into a directory (no sudo, no curl|sh).
# Every download is verified against a sha256 pinned here before it is used.
#
#   install-ci-tools.sh <bin-dir> <kubectl|kubeconform|k3d>...
#
# linux/amd64 and linux/arm64 (picked from uname -m). Add <bin-dir> to PATH.
# Checksum sources: kubectl https://dl.k8s.io/release/<v>/bin/linux/<arch>/kubectl.sha256;
# kubeconform the release CHECKSUMS file; k3d publishes none, so its pins were computed
# from the release binaries (amd64 matches the earlier pin). Refresh all when bumping a version.
set -euo pipefail

KUBECTL_VERSION=v1.37.2
KUBECTL_SHA256_AMD64=c04487523e7aa7d1493f7808174c899db93d7a9cf57531420cd76b9bd415f8f4
KUBECTL_SHA256_ARM64=fcc16f63186659d9722014b7e02d5fdd2d4e669cb8c0ab66365d7d3b8ba03509
KUBECONFORM_VERSION=v0.8.0
KUBECONFORM_SHA256_AMD64=9bc2bffbf71f261128533edaf912153948b7ff238f9a531ae6d34466ec287883
KUBECONFORM_SHA256_ARM64=1f53fc8e81258197a35e8603054162a5af1de8c5af13746c71ab680d9534ed87
K3D_VERSION=v5.9.0
K3D_SHA256_AMD64=06d8f25bc3a971c4eb29e0ff08429b180402db0f4dec838c9eac427e296800a0
K3D_SHA256_ARM64=03cde5cf23e6e8e67de5a039ecf26e5b85aca82fba3e5d13dadf904cd218a250

case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *)
    echo "install-ci-tools: unsupported machine $(uname -m) (need x86_64 or aarch64)" >&2
    exit 1
    ;;
esac
pin() { local name="${1}_SHA256_${arch^^}"; echo "${!name}"; } # TOOL -> sha256 for this arch

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
      fetch "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${arch}/kubectl" "$(pin KUBECTL)" "$work/kubectl"
      install -m 755 "$work/kubectl" "$bin/kubectl"
      ;;
    kubeconform)
      fetch "https://github.com/yannh/kubeconform/releases/download/${KUBECONFORM_VERSION}/kubeconform-linux-${arch}.tar.gz" \
        "$(pin KUBECONFORM)" "$work/kubeconform.tgz"
      mkdir "$work/kc"
      tar -xzf "$work/kubeconform.tgz" -C "$work/kc" kubeconform
      install -m 755 "$work/kc/kubeconform" "$bin/kubeconform"
      ;;
    k3d)
      fetch "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${arch}" "$(pin K3D)" "$work/k3d"
      install -m 755 "$work/k3d" "$bin/k3d"
      ;;
    *)
      echo "install-ci-tools: unknown tool $tool" >&2
      exit 2
      ;;
  esac
  echo "install-ci-tools: $tool installed in $bin"
done
