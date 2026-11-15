# ADR-0026: K3s manifests (Kustomize), secrets, bootstrap and deploy path

Amends ADR-0011 (host choice, "bootstrap and migrations as K8s Jobs") and
spec section 9 ("Job before services").

## Context

Phase 9 deploys the stack on one K3s node behind the bundled Traefik v3. The
host is not chosen yet (Oracle Cloud A1 or Google Cloud are both possible), the
manifests must be provable without that VM, and no secret may live in git.

## Decision

1. **Secrets** are generated on the VM by `setup-local.mjs --env infra/k8s/.env`
   and applied as one Secret, `eticket-secrets`, with
   `kubectl create secret --from-env-file`. The Secret holds an allow-list of
   keys only; `ADMIN_PASSWORD_DEV` never enters the cluster. Workloads
   reference it with `secretKeyRef`, and `DATABASE_URL` /
   `MIGRATION_DATABASE_URL` are built with `$(VAR)` interpolation, so no URL
   with a password is stored anywhere.
2. **Deploy** is an opt-in GitHub Actions CD job (`deploy.yml`) that SSHes to
   the VM and runs `infra/k8s/scripts/deploy.sh`; the same script is the manual
   path. The job auto-runs only after a successful **push** run of `Images` on
   `main` (fork-safe; no untrusted ref reaches the secrets), and its
   `production` environment is limited to `main`. An `Images` run dispatched by
   hand (the seeding run) does not deploy: dispatch `deploy.yml` with the tag.
   Runs queue behind one `deploy-prod` concurrency group, so only the latest
   pending deploy survives.
3. **Testing without the VM**: kubeconform validates the rendered manifests,
   `manifest.test.mjs` asserts the review-focus invariants, and a k3d CI job
   deploys the `local` overlay in a real K3s.
4. **Host-agnostic**: any Linux VM with at least 2 vCPU / 4 GB, amd64 or arm64,
   ports 80 and 443 open. ADR-0011's "Oracle only" no longer binds.
5. **Postgres bootstrap through `docker-entrypoint-initdb.d`, not a Job.**
   `00-roles.sh` is not re-runnable (`CREATE ROLE` fails twice) and a Job's pod
   template is immutable on re-apply. initdb runs once on an empty volume,
   exactly as in compose, from a ConfigMap generated from the same file.
6. **Migrations as an initContainer of each DB service, not a Job.** Same
   `migrate-<schema>` image and URL as compose. The service starts only after
   `migrate deploy` exits 0, and a new image tag re-runs it on every rollout.
   Prisma takes an advisory lock, so a second replica is safe. A
   `wait-postgres` initContainer runs first.
7. **Every image gets every `sha-<7>` tag.** `images.yml` re-tags each unchanged
   image on `main` from the **previous main commit's** `sha-<7>` tag (registry
   side, no rebuild), not from `latest`: `latest` moves with concurrent runs, the
   previous commit's tag does not, so no run is dropped and none races. The first
   `main` commit has no predecessor: seed the set once by dispatching `Images`
   on `main` with `all=true`. A deploy then pins all eight images to one commit
   and the prod overlay never uses `latest`.
8. **Client IP**: Traefik's Service gets `externalTrafficPolicy: Local` (a
   HelmChartConfig), and the gateway trusts one hop (`TRUST_PROXY=1`).
9. **Two Ingress objects**, `api` (middlewares `strip-api` and `api-ratelimit`)
   and `web` (none). Traefik applies middlewares per router, and StripPrefix
   must not touch the SPA. `/api` is longer than `/`, so it wins.
10. **Kustomize layout**: `base` plus overlays `local` (k3d: `eticketing/*:local`,
    `imagePullPolicy: Never`, HTTP) and `prod`. The prod overlay is a template
    filled by `render-prod.mjs` (host, tag; validated) into a git-ignored
    directory two levels below `infra/k8s`, so `../../base` resolves. Renders
    use `--load-restrictor LoadRestrictionsNone` because the initdb ConfigMap
    reads `infra/postgres/init/00-roles.sh`, the single source shared with
    compose.
11. **Pod security**: non-root with numeric UIDs (node 1000, nginx 101, .NET
    1654, postgres 70, all set explicitly because the images use named users),
    no privilege escalation, all capabilities dropped, seccomp
    `RuntimeDefault`, requests and limits, one replica (spec section 10: the
    jobs assume one replica).
12. **CI binaries**: `k3d` v5.9.0 and `kubeconform` v0.8.0 (plus `kubectl`
    v1.37.2) are downloaded by `install-ci-tools.sh`, pinned by version and
    sha256, linux/amd64 only. They are CI and dev-laptop tools, not repo
    dependencies. `k3d-e2e.sh` uses a private `KUBECONFIG`, so it can never
    touch another cluster context.
13. **Manifest tests need no YAML dependency**: they parse `kubectl kustomize`
    output with a small purpose-built parser (`lib/yaml-lite.mjs`).

## Alternatives

- **Bootstrap and migrations as Jobs** (spec section 9): immutable pod templates
  on re-apply and a non-re-runnable roles script. Rejected; cost if wrong: a
  password rotation needs a manual `ALTER ROLE`.
- **Sealed Secrets / SOPS / external secrets**: another controller or key to
  manage for a one-node demo. Rejected.
- **Helm chart**: templating we do not need; Kustomize is built into `kubectl`.
- **One Ingress with a per-path middleware**: not expressible in Traefik.
- **Plain compose on the VM**: already ADR-0011's rejected alternative.

## Trade-off

Single node, one replica per workload: no high availability, and a rollout
restarts the pod. Migration logs live in the pod's init container
(`kubectl logs <pod> -c migrate`). The Postgres pod runs as uid 70 instead of
starting as root and dropping privileges, so initdb is only proven at runtime
by the k3d job. The `prod` overlay needs public GHCR images (or an image pull
secret added by the operator).
