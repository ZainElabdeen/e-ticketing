# Phase 9 report: K3s deployment, deploy guide and README

Phase 9 of [docs/PROMPT.md](../PROMPT.md): K3s manifests, deploy guide, README with architecture diagram, service
responsibilities, local run, deploy, environment variables, API examples, assumptions and trade-offs. Plan:
[docs/plans/2026-11-15-phase-9-k3s.md](../plans/2026-11-15-phase-9-k3s.md). Decisions:
[ADR-0026](../adr/0026-k3s-manifests-and-deploy.md) (amends [ADR-0011](../adr/0011-deployment-k3s-single-vm.md)).

## 1. What was built

- **Kubernetes manifests** (`infra/k8s`, Kustomize): a `base` plus a `local` overlay (k3d, plain HTTP) and a `prod`
  overlay rendered on the server (host, image tag, TLS, Swagger off, HSTS on the web router). Postgres StatefulSet with
  the compose role script as initdb, three database services whose `migrate` initContainer runs
  `prisma migrate deploy` before the app starts, gateway, web (nginx), two Traefik Ingresses (`/api` with prefix strip
  and an outer per-IP rate limit; everything else to web), a daily `pg_dump` CronJob. Every Service is `ClusterIP`;
  only Traefik is public. Containers run as non-root with dropped capabilities, requests and limits, and probes on
  `/health/live` and `/health/ready`.
- **Traefik configuration** (`HelmChartConfig`): HTTP to HTTPS (308), Let's Encrypt (HTTP-01), persistent
  `acme.json`, and `externalTrafficPolicy: Local` so per-IP rate limits see real clients.
- **Operator scripts** (`infra/k8s/scripts`): `apply-secrets.sh` (15-key allow-list, values never printed,
  server-side apply), `deploy.sh <sha-tag>` (GHCR tag gate for all eight images, render, apply, rollout gate,
  `DEPLOY OK`), `render-prod.mjs` (validated host, tag and email; output paths confined), `validate.sh`
  (kubeconform), `k3d-e2e.sh` (real K3s in Docker), `install-ci-tools.sh` (pinned, checksum-verified kubectl,
  kubeconform, k3d on amd64 and arm64).
- **CI/CD**: `verify` validates the manifests; a `k3d` job deploys the stack into a real K3s cluster and runs the
  smoke test, the gateway contract suite, an idempotent redeploy, a spoofed-`X-Forwarded-For` rate-limit check and the
  Traefik runtime checks. `images.yml` re-tags unchanged images from the previous `main` commit so every commit has a
  full `sha-<7>` set. `deploy.yml` deploys over SSH after `Images` succeeds on a push to `main` (only the head of
  `main`; manual dispatch for rollbacks; commit must be on `main`).
- **Hardening carried from the audit**: compose restart policies, base images pinned by digest, migrate image built
  from a lockfile, nginx `Permissions-Policy` and JSON compression, Postgres healthcheck timeout.
- **Documentation**: root [README](../../README.md) (overview, live demo, Mermaid architecture, services, local
  run, deploy, environment variables, `curl` API examples, five-minute demo, CI/CD, assumptions and trade-offs);
  generic guide [infra/k8s/README.md](../../infra/k8s/README.md); live deployment record
  [docs/deployment-gcp.md](../deployment-gcp.md).
- **Live deployment**: Google Cloud `e2-medium` VM, K3s `v1.37.2+k3s1`, DuckDNS name with a Let's Encrypt
  certificate, images from release `main`. Continuous deployment enabled and proven (`DEPLOY OK`).

## 2. Decisions and why

| Decision | Why | Record |
| --- | --- | --- |
| Kustomize, not Helm | Built into `kubectl`, no new dependency; two overlays are enough | ADR-0026 |
| Secrets generated on the server, never in git or GitHub | The database passwords, keys and admin hash never leave the VM | ADR-0026 |
| Postgres bootstrap through initdb, not a Job | The role script is not re-runnable and a Job's template is immutable on re-apply | ADR-0026 |
| Migrations as an initContainer, not a Job | Each rollout re-runs `migrate deploy`; the app never starts on an old schema | ADR-0026 |
| Re-tag unchanged images from the previous `main` commit, not from `latest` | Race-free with overlapping image runs; no run is dropped | ADR-0026 |
| Auto-deploy only after a push to `main`, only the head of `main` | Fork-safe; an older run finishing late cannot roll production back | ADR-0026 |
| `externalTrafficPolicy: Local` and `TRUST_PROXY=1` | Otherwise every visitor shares one rate-limit bucket | ADR-0026 |
| Host-agnostic VM; live on Google Cloud `e2-medium` | The free 1 GB tiers cannot run K3s plus six workloads; an existing VM was busy and nearly full | ADR-0026, [deployment record](../deployment-gcp.md) |
| SSH port open, key-only, fail2ban, dedicated restricted deploy key | GitHub-hosted runners have no fixed address range, so CD over SSH cannot use an allow-list | [deployment record](../deployment-gcp.md) |
| k3d end to end in CI | Proves the manifests in a real cluster before any VM exists | ADR-0026 |

## 3. How to test it yourself

```bash
node --test infra/k8s/scripts/            # manifest and script tests
infra/k8s/scripts/validate.sh             # kubeconform over the rendered overlays
infra/k8s/scripts/k3d-e2e.sh              # real K3s in Docker (needs disk headroom; ~10 min)
infra/k8s/scripts/deploy.sh sha-abc1234 --dry-run   # with K8S_ENV_FILE pointing at a file of fake values
```

Live: `https://eticket-zain.duckdns.org/` (shop) and `/backoffice` (while the demo VM runs). Server steps:
[docs/deployment-gcp.md](../deployment-gcp.md).

## Gate

| Step | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format:check` | exit 0 |
| Build | `pnpm build` | exit 0 |
| Unit tests | `pnpm test` | exit 0 |
| Integration tests | `pnpm test:int` | exit 0 |
| Generated contracts | `pnpm --filter @eticket/contracts check:generated` | exit 0 |
| Manifests | `infra/k8s/scripts/validate.sh` | 42 resources valid, 0 invalid |
| k8s script tests | `node --test infra/k8s/scripts/` | 59 pass, 0 fail |
| Compose runtime | `infra/scripts/smoke.sh --keep` (fresh volume) + four contract suites | `SMOKE OK`; ticket 38/38, payment 17/17, ledger 16/16, gateway 22/22 |
| K3s runtime | CI `k3d` job (PR #5) | `SMOKE OK`, gateway contract 21/21, `K3D E2E OK` (a local run was blocked by workstation disk pressure) |
| Live deploy | `deploy.sh sha-<7>` on the VM, then `deploy.yml` dispatch | `DEPLOY OK` both ways |
| Backups | manual CronJob run + `pg_restore --list` | dump written, all tables listed |

## Drift check

Spec §9 (deployment), §11 (traceability) and §13 (ADR index) describe what was built, including the rulings that
changed the original wording (initdb and initContainer instead of Jobs, host-agnostic VM, CD job, re-tag source). No
unrecorded deviations.

## Carried forward (not done in Phase 9)

- NetworkPolicies between workloads (only `ClusterIP` Services today), `readOnlyRootFilesystem`,
  `automountServiceAccountToken: false`.
- Backups live on the same disk as the database; off-site copies are out of scope for a demo.
- A failed `k3d cluster create` leaves a half-made cluster (`k3d-e2e.sh` refuses to reuse it).
- The validation schema location for core Kubernetes types is not pinned (CRD schemas are).
