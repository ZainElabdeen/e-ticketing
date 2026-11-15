#!/usr/bin/env bash
# End-to-end proof of the K3s manifests in a real K3s cluster (k3d).
#
#   k3d-e2e.sh [--keep]
#
# Creates cluster `eticketing` (host port 8081 -> Traefik :80), builds the eight images from
# .github/images.json as eticketing/<name>:local, imports them, applies the `local` overlay,
# runs the smoke test and the gateway contract suite through the ingress, re-applies the overlay
# (Postgres must not be recreated, migrations must report nothing pending), checks that a spoofed
# X-Forwarded-For cannot dodge the login limit, and finally applies the Traefik HelmChartConfig
# and checks the redirect, externalTrafficPolicy and the ACME volume.
# Needs docker, k3d, kubectl and node on PATH. Ends with `K3D E2E OK`.
# --keep leaves the cluster up; by default the EXIT trap deletes cluster `eticketing` (and only it).
# Never prints env values: infra/k8s/.env and the admin login are generated, never shown.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$root"
scripts=infra/k8s/scripts
cluster=eticketing
ns=eticketing
host_port=8081
base_url="http://localhost:${host_port}"
k3s_image="rancher/k3s:v1.37.2-k3s1"
env_file=infra/k8s/.env

keep=0
created=0
case "${1:-}" in
  "") ;;
  --keep) keep=1 ;;
  *)
    echo "usage: k3d-e2e.sh [--keep]" >&2
    exit 2
    ;;
esac

tmp="$(mktemp -d)"
# A private kubeconfig: kubectl can never fall through to another cluster in the caller's
# ~/.kube/config (a laptop often has a real cloud context selected).
export KUBECONFIG="$tmp/kubeconfig"
step() { echo; echo "==> $*"; }
fail() { echo "K3D E2E FAILED: $*" >&2; exit 1; }

# Names of the pods matching a label that are not terminating (a rollout leaves the old pod
# listed for a while; jsonpath cannot filter on an absent deletionTimestamp).
live_pods() { # namespace label-selector
  kubectl -n "$1" get pod -l "$2" \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.deletionTimestamp}{"\n"}{end}' \
    | awk -F'\t' '$2 == "" {print $1}'
}

dump() {
  echo "---- diagnostics (no env values, no secrets) ----" >&2
  kubectl get all,events -n "$ns" 2>&1 | tail -n 150 >&2 || true
  local pod
  for pod in $(kubectl get pods -n "$ns" -o name 2>/dev/null); do
    if ! kubectl get -n "$ns" "$pod" -o jsonpath='{range .status.conditions[?(@.type=="Ready")]}{.status}{end}' 2>/dev/null | grep -q True; then
      echo "---- describe $pod ----" >&2
      kubectl describe -n "$ns" "$pod" 2>&1 | grep -v -i -E '^\s+[A-Z_]+_(PASSWORD|KEY|SECRET)' | tail -n 80 >&2 || true
    fi
    local c
    for c in $(kubectl get -n "$ns" "$pod" -o jsonpath='{.spec.initContainers[*].name} {.spec.containers[*].name}' 2>/dev/null); do
      echo "---- logs $pod/$c (last 100) ----" >&2
      kubectl logs -n "$ns" "$pod" -c "$c" --tail=100 2>&1 >&2 || true
    done
  done
  echo "---- kube-system pods ----" >&2
  kubectl get pods,jobs -n kube-system 2>&1 >&2 || true
  for pod in $(kubectl get pods -n kube-system -o name 2>/dev/null | grep -E 'traefik' | grep -v svclb); do
    echo "---- logs kube-system/$pod (last 100) ----" >&2
    kubectl logs -n kube-system "$pod" --tail=100 2>&1 >&2 || true
  done
}

cleanup() {
  local code=$?
  if [[ $code -ne 0 ]]; then dump || true; fi
  rm -rf "$tmp"
  if [[ $created -eq 0 ]]; then
    :  # never delete a cluster this run did not create
  elif [[ $keep -eq 1 ]]; then
    echo "k3d-e2e: --keep: cluster $cluster left running (delete: k3d cluster delete $cluster)"
  else
    k3d cluster delete "$cluster" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

for tool in docker k3d kubectl node; do
  command -v "$tool" >/dev/null || fail "$tool not found on PATH"
done

step "creating cluster $cluster ($k3s_image), host port $host_port -> ingress"
if k3d cluster list -o json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(l.some(c=>c.name==="'"$cluster"'")?0:1)'; then
  fail "cluster $cluster already exists (k3d cluster delete $cluster)"
fi
k3d cluster create "$cluster" --image "$k3s_image" -p "${host_port}:80@loadbalancer" --wait --timeout 240s \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false
created=1
k3d kubeconfig get "$cluster" >"$KUBECONFIG"
chmod 600 "$KUBECONFIG"
[[ "$(kubectl config current-context)" == "k3d-$cluster" ]] || fail "kubectl is not pointing at k3d-$cluster"
kubectl wait --for=condition=Ready node --all --timeout=120s

step "building the eight images as eticketing/<name>:local"
images=()
while IFS=$'\t' read -r name dockerfile args; do
  build_args=()
  for a in $args; do build_args+=(--build-arg "$a"); done
  echo "build $name"
  docker build -q -f "$dockerfile" "${build_args[@]}" -t "eticketing/$name:local" . >/dev/null
  images+=("eticketing/$name:local")
done < <(node -e '
  const list = JSON.parse(require("fs").readFileSync(".github/images.json", "utf8"));
  for (const i of list) console.log([i.name, i.dockerfile, Object.entries(i.buildArgs).map(([k, v]) => `${k}=${v}`).join(" ")].join("\t"));
')
[[ ${#images[@]} -eq 8 ]] || fail "expected 8 images, built ${#images[@]}"
k3d image import "${images[@]}" -c "$cluster"

step "generating secrets and applying the local overlay"
# setup-local.mjs never overwrites real values, so an existing infra/k8s/.env is reused as is
# for this throwaway cluster (its secrets only ever seed the cluster's own Secret).
node infra/scripts/setup-local.mjs --env "$env_file" --no-ports --email ci@example.test --login-file "$tmp/admin-login.txt" >/dev/null
"$scripts/apply-secrets.sh"
rendered="$tmp/local.yaml"
"$scripts/render.sh" local >"$rendered"
workloads="$(node "$scripts/ghcr.mjs" workloads <"$rendered")"
[[ -n "$workloads" ]] || fail "no workloads in the rendered overlay"
kubectl apply -f "$rendered"

rollout_all() {
  local w
  for w in $workloads; do
    kubectl -n "$ns" rollout status "$(echo "$w" | tr 'A-Z' 'a-z')" --timeout=420s
  done
}
rollout_all

step "waiting for the ingress to reach the gateway"
for _ in $(seq 1 60); do
  if curl -fsS "$base_url/api/health/ready" >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS "$base_url/api/health/ready" >/dev/null || fail "gateway not ready through the ingress"

step "smoke test through the ingress"
SMOKE_GATEWAY_URL="$base_url/api" node --env-file="$env_file" infra/scripts/smoke.mjs

step "gateway contract suite through the ingress"
CONTRACT_GATEWAY_BASE_URL="$base_url/api" CONTRACT_ENV_FILE="$env_file" infra/scripts/contract.sh gateway

step "re-applying the overlay (idempotency)"
pg_uid_before="$(kubectl -n "$ns" get pod postgres-0 -o jsonpath='{.metadata.uid}')"
kubectl apply -f "$rendered"
rollout_all
pg_uid_after="$(kubectl -n "$ns" get pod postgres-0 -o jsonpath='{.metadata.uid}')"
[[ "$pg_uid_before" == "$pg_uid_after" ]] || fail "postgres-0 was recreated by the second apply"
echo "postgres-0 kept (same pod UID)"
# A no-op apply keeps the pods, so their init logs are still the first run's. Restart the three
# DB services: each new pod runs `migrate deploy` again against the already migrated schema.
for svc in ticket-service payment-service ledger-service; do
  kubectl -n "$ns" rollout restart "deployment/$svc"
done
for svc in ticket-service payment-service ledger-service; do
  kubectl -n "$ns" rollout status "deployment/$svc" --timeout=300s
done
for svc in ticket-service payment-service ledger-service; do
  pod="$(live_pods "$ns" "app.kubernetes.io/name=$svc")"
  [[ "$pod" != *$'\n'* && -n "$pod" ]] || fail "$svc: expected exactly one live pod, got '$pod'"
  log="$(kubectl -n "$ns" logs "$pod" -c migrate 2>&1)" || fail "no migrate log for $svc"
  grep -q 'No pending migrations' <<<"$log" || {
    echo "$log" | tail -n 5 >&2
    fail "$svc migrate init did not report 'No pending migrations'"
  }
  echo "$svc: No pending migrations"
done

step "spoofed X-Forwarded-For must not dodge the login limit"
# Every attempt carries a DIFFERENT spoofed X-Forwarded-For. If the gateway keyed its limit on
# that header, each attempt would get a fresh bucket and none would ever be throttled, so any
# gateway-sourced 429 proves the key is the real peer, not the header. The 429 must carry the
# gateway's error envelope (code RATE_LIMITED), not Traefik's plain-text rate-limit reply.
got429=0
for n in $(seq 1 11); do
  code="$(curl -s -o "$tmp/login.body" -w '%{http_code}' -X POST "$base_url/api/v1/auth/login" \
    -H 'content-type: application/json' -H "X-Forwarded-For: 203.0.113.$n" \
    -d '{"email":"nobody@example.test","password":"wrong-password-0"}')"
  echo "attempt $n: HTTP $code"
  if [[ "$code" == 429 ]]; then
    got429=1
    node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(b.code==="RATE_LIMITED"?0:1)' "$tmp/login.body" \
      || fail "429 did not come from the gateway (body is not the RATE_LIMITED error envelope)"
    break
  fi
done
[[ $got429 -eq 1 ]] || fail "no 429 within 11 login attempts: a spoofed X-Forwarded-For escaped the limit"

step "Traefik HelmChartConfig (redirect, client IP, ACME volume)"
traefik_yaml="$tmp/traefik.yaml"
overlay_dir="infra/k8s/.rendered/k3d-e2e-$$"
mkdir -p "$overlay_dir"
node "$scripts/render-prod.mjs" --host demo.example.org --tag sha-abc1234 --out "$overlay_dir" \
  --acme-email ci@example.test --traefik-out "$traefik_yaml" >/dev/null
rm -rf "$overlay_dir"
job_uid_before="$(kubectl -n kube-system get job helm-install-traefik -o jsonpath='{.metadata.uid}' 2>/dev/null || true)"
kubectl apply -f "$traefik_yaml"
# The Helm controller upgrades the chart in a fresh helm-install-traefik job.
for _ in $(seq 1 90); do
  uid="$(kubectl -n kube-system get job helm-install-traefik -o jsonpath='{.metadata.uid}' 2>/dev/null || true)"
  policy="$(kubectl -n kube-system get svc traefik -o jsonpath='{.spec.externalTrafficPolicy}' 2>/dev/null || true)"
  [[ "$policy" == Local && -n "$uid" && "$uid" != "$job_uid_before" ]] && break
  sleep 2
done
kubectl -n kube-system wait --for=condition=complete job/helm-install-traefik --timeout=240s
kubectl -n kube-system rollout status deployment/traefik --timeout=240s

policy="$(kubectl -n kube-system get svc traefik -o jsonpath='{.spec.externalTrafficPolicy}')"
[[ "$policy" == Local ]] || fail "traefik Service externalTrafficPolicy is '$policy', expected Local"
echo "traefik Service externalTrafficPolicy: Local"

location=""
code=""
for _ in $(seq 1 60); do
  headers="$(curl -sI "$base_url/" || true)"
  code="$(awk 'NR==1{print $2}' <<<"$headers")"
  location="$(awk 'tolower($1)=="location:"{print $2}' <<<"$headers" | tr -d '\r')"
  [[ "$code" == 301 || "$code" == 308 ]] && break
  sleep 2
done
[[ "$code" == 301 || "$code" == 308 ]] || fail "http redirect expected 301/308, got '$code'"
[[ "$location" == https://* ]] || fail "redirect Location is not https://: '$location'"
echo "http -> https redirect: HTTP $code, Location $location"

# The pod of the new ReplicaSet: not terminating, and carrying the PVC volume (an old pod, still
# listed while it shuts down, has none).
tpod=""
for _ in $(seq 1 30); do
  for cand in $(live_pods kube-system app.kubernetes.io/name=traefik); do
    if kubectl -n kube-system get pod "$cand" -o jsonpath='{range .spec.volumes[*]}{.persistentVolumeClaim.claimName}{"\n"}{end}' | grep -q .; then
      tpod="$cand"
    fi
  done
  [[ -n "$tpod" ]] && break
  sleep 2
done
[[ -n "$tpod" ]] || fail "no traefik pod has a PersistentVolumeClaim volume"
kubectl -n kube-system get pod "$tpod" -o jsonpath='{range .spec.containers[0].volumeMounts[*]}{.mountPath}{"\n"}{end}' | grep -qx /data \
  || fail "traefik pod does not mount a volume at /data"
echo "traefik pod $tpod mounts a PVC at /data"
if kubectl -n kube-system logs "$tpod" 2>&1 | grep -i 'permission denied' | grep -q '/data'; then
  fail "traefik logs show 'permission denied' for /data"
fi
echo "traefik logs: no permission denied for /data"

echo
echo "K3D E2E OK"
