# Deploy to K3s (single VM)

Runs the whole stack (Postgres, ticket/payment/ledger services, gateway, web) on one K3s node behind
the bundled Traefik, with a Let's Encrypt certificate. Design and rulings: [ADR-0026](../../docs/adr/0026-k3s-manifests-and-deploy.md)
(amends [ADR-0011](../../docs/adr/0011-deployment-k3s-single-vm.md)). Run it locally instead: [docs/local-demo.md](../../docs/local-demo.md).

**Where each command runs.** `[laptop]` = your machine, `[VM]` = the K3s server over SSH,
`[GitHub]` = repo settings or `gh`. Commands without a tag run in the repo root.

## What gets deployed

| Piece                                                 | Kind                               | Notes                                                                                                                              |
| ----------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `postgres`                                            | StatefulSet, 10Gi `local-path` PVC | Roles and schemas come from `infra/postgres/init/00-roles.sh` through `docker-entrypoint-initdb.d` (runs once, on an empty volume) |
| `ticket-service`, `payment-service`, `ledger-service` | Deployment, 1 replica              | initContainers `wait-postgres` then `migrate` (`prisma migrate deploy`) run before the app starts                                  |
| `gateway`, `web`                                      | Deployment, 1 replica              | `web` is nginx serving the SPA                                                                                                     |
| Ingress `api` / `web`                                 | Traefik                            | `/api/*` goes to the gateway (prefix stripped, rate limit); everything else to `web`                                               |
| `postgres-backup`                                     | CronJob, 5Gi PVC                   | Daily `pg_dump -Fc`, 7 dumps kept                                                                                                  |
| Secret `eticket-secrets`                              | created by `apply-secrets.sh`      | Never in git; 15 allow-listed keys                                                                                                 |

All Services are `ClusterIP`; only Traefik (ports 80 and 443) faces the internet. Images are
`ghcr.io/zainelabdeen/e-ticketing/<name>:sha-<7>`, one tag for all eight images per commit.

## Scripts (`infra/k8s/scripts/`)

| Script                                                     | Use                                                                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `render.sh <local\|prod\|dir>`                             | Print the rendered manifests of an overlay                                                                                                                                             |
| `validate.sh`                                              | Render local, a sample prod and the Traefik config; run `kubeconform -strict` (needs `kubectl`, `kubeconform`)                                                                         |
| `k3d-e2e.sh [--keep]`                                      | Real K3s in Docker (k3d): deploy the `local` overlay, run smoke and the gateway contract suite, redeploy, check the redirect. Uses its own cluster and a private kubeconfig; port 8081 |
| `install-ci-tools.sh <dir> <kubectl\|kubeconform\|k3d>...` | Install the pinned, sha256-checked CLI tools (linux/amd64)                                                                                                                             |
| `apply-secrets.sh [--dry-run]`                             | `infra/k8s/.env` to Secret `eticket-secrets` (server-side apply; `K8S_ENV_FILE` overrides the path)                                                                                    |
| `deploy.sh <sha-xxxxxxx> [--dry-run]`                      | Check the tag on GHCR for all eight images, apply secrets, render prod, apply, wait for rollouts, print `DEPLOY OK <tag>`                                                              |
| `render-prod.mjs`                                          | Fill host, tag and ACME email into the prod overlay / Traefik config                                                                                                                   |

## One-time setup

### 1. Pick a VM [laptop]

Any Linux VM with at least 2 vCPU and 4 GB RAM, amd64 or arm64 (all images are multi-arch), ports 80 and 443
open to the world and 22 open to your IP. Ubuntu 24.04 LTS is assumed below. Check current free-tier terms
before you pick; they change.

|         | Oracle Cloud (Always Free)                                                                                                                                          | Google Cloud                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Shape   | Ampere A1 (ARM64), up to 4 OCPU / 24 GB in the free allowance; use 2 OCPU / 12 GB or more                                                                           | `e2-medium` (x86, 2 vCPU / 4 GB, paid) or `t2a-standard-2` (ARM, paid). The free `e2-micro` (1 GB) is too small |
| Disk    | 50 GB boot volume is plenty                                                                                                                                         | 30 GB `pd-balanced` is plenty                                                                                   |
| Network | Add ingress rules for TCP 80 and 443 to the subnet's security list or NSG. The Ubuntu image also ships host `iptables` rules that reject everything else: see below | VPC firewall rule for 80 and 443 (below). Reserve a static external IP so DNS does not break on a stop/start    |
| Caveat  | Idle Always Free instances can be reclaimed; capacity for A1 is often unavailable in a region                                                                       | Billed per hour; stop the VM when you are not demoing                                                           |

Oracle host firewall [VM]:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Google Cloud firewall and static IP [laptop, `gcloud`]:

```bash
gcloud compute firewall-rules create eticket-web --allow tcp:80,tcp:443 --target-tags eticket
gcloud compute addresses create eticket-ip --region <region>
# create the VM with --tags eticket --address eticket-ip
```

Keep SSH (22) limited to your own IP on both clouds.

### 2. DNS [laptop]

Let's Encrypt (HTTP-01) needs a public name that resolves to the VM and port 80 reachable.

- DuckDNS (free): sign in at duckdns.org, create a subdomain, set its IP to the VM's public IP. The name is `<sub>.duckdns.org`.
- Any other DNS: an `A` record for the host (for example `eticket.example.org`) pointing at the VM's IP.

Check: `dig +short <host>` returns the VM IP. This value is `HOST` below.

### 3. Install K3s [VM]

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.37.2+k3s1' sh -
sudo k3s kubectl get nodes          # Ready after about a minute
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config && sudo chown "$USER" ~/.kube/config
kubectl get nodes                   # the scripts call plain `kubectl`; it must work without sudo
```

The CD job runs `deploy.sh` over a non-interactive SSH session, so confirm that works too from your laptop:
`ssh <user>@<host> kubectl get nodes`.

Install Node 26 and pnpm on the VM (`setup-local.mjs` loads `bcryptjs` from the workspace; `deploy.sh` needs only `node` and `kubectl`):

```bash
# [VM] one way, with nvm (https://github.com/nvm-sh/nvm); any Node 26 install works
nvm install 26 && npm i -g pnpm@10.34.9
```

### 4. Clone the repo and generate the secrets [VM]

```bash
git clone https://github.com/zainelabdeen/e-ticketing.git ~/e-ticketing && cd ~/e-ticketing
pnpm install --frozen-lockfile
node infra/scripts/setup-local.mjs --env infra/k8s/.env --no-ports --email <you@example.com>
```

This writes every password, API key and the JWT secret into the git-ignored `infra/k8s/.env` (mode 600)
and prints the backoffice admin password **once**, to the terminal (or to `infra/.admin-login.txt` when stdout is not a TTY;
store it, then delete the file). It never overwrites a real value on re-run. Never `cat` the env file.

Add the two deploy settings (they are not secrets and stay out of the cluster Secret):

```bash
printf 'HOST=%s\nACME_EMAIL=%s\n' '<host>' '<you@example.com>' >> infra/k8s/.env
```

### 5. Configure Traefik once [VM]

The bundled Traefik is tuned by a `HelmChartConfig`: `externalTrafficPolicy: Local` (so the per-IP rate limits see
real client IPs), HTTP to HTTPS (308), the Let's Encrypt resolver `le` (HTTP-01) and a volume for `acme.json`.
Render it with your email and copy it into K3s' auto-apply directory:

```bash
EMAIL=<you@example.com>
node infra/k8s/scripts/render-prod.mjs --host <host> --tag sha-0000000 --out infra/k8s/.rendered/traefik \
  --acme-email "$EMAIL" --traefik-out /tmp/traefik-config.yaml
sudo cp /tmp/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
```

(`--tag` only fills the prod overlay written to `--out`; the value is irrelevant here.) K3s reconciles the file and restarts Traefik.

### 6. Make the GHCR images pullable [GitHub]

Images are pushed by CI to `ghcr.io/zainelabdeen/e-ticketing/<name>` from `main` only. The cluster pulls
anonymously, so each of the eight packages must be public: GitHub, your profile, Packages, open a package,
Package settings, Danger Zone, Change visibility, Public. Repeat for `ticket-service`, `payment-service`,
`ledger-service`, `gateway`, `web`, `migrate-tickets`, `migrate-payments`, `migrate-ledger`. (Alternative: keep them private and add an `imagePullSecret` to
each workload yourself; the repo does not do that.) `deploy.sh` checks every tag anonymously and names the image
that is missing or private.

### 7. First deploy

CI builds only the images that changed, and re-tags the rest from the previous `main` commit. The very first
`main` commit has no previous tags, so seed them once:

1. [GitHub] Actions, workflow `Images`, Run workflow on `main` with `all` checked (or `gh workflow run images.yml --ref main -f all=true`).
   Wait for it to finish; it tags all eight images `sha-<7>` and `latest`.
2. [VM] Deploy that commit:

```bash
cd ~/e-ticketing && git checkout --detach <sha>        # the commit the Images run built
infra/k8s/scripts/deploy.sh sha-<first 7 of sha>       # ends with: DEPLOY OK sha-xxxxxxx
```

`deploy.sh` is idempotent: it applies the Secret (`apply-secrets.sh`), renders the `prod` overlay and applies it.
Re-running never re-bootstraps the database. Add `--dry-run` to validate and list the resources without touching a cluster or GHCR.

Open `https://<host>/`. The first request can take a minute while Traefik obtains the certificate
(see [Troubleshooting](#troubleshooting)). Log in to `https://<host>/backoffice` with the email and password from step 4.

## Continuous deployment (optional)

`.github/workflows/deploy.yml` deploys after each successful `Images` run on a push to `main`, and on manual dispatch.
It is skipped (green) while `DEPLOY_HOST` is not set. It SSHes to the VM, fetches that commit, runs `deploy.sh sha-<7>`
and requires the line `DEPLOY OK <tag>`.

Rules:

- Auto-deploy only follows a **push** to `main` (fork-safe). An `Images` run you dispatched by hand (for example the
  seeding run with `all=true`) does not deploy; dispatch `Deploy` yourself with the tag.
- One deploy runs at a time (`concurrency: deploy-prod`); GitHub keeps one pending run, so with several merges in a row only the latest waits and wins.
- The `production` environment must be limited to `main`, otherwise any branch's workflow could read the SSH key.

Set it up:

```bash
# [laptop] a dedicated key, used for nothing else
ssh-keygen -t ed25519 -f ~/.ssh/eticket_deploy -N '' -C eticket-deploy
ssh-copy-id -i ~/.ssh/eticket_deploy.pub <user>@<host>       # or append the .pub to ~/.ssh/authorized_keys on the VM

# [GitHub] the environment, restricted to main
gh api -X PUT repos/zainelabdeen/e-ticketing/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/zainelabdeen/e-ticketing/environments/production/deployment-branches -f name=main

# [GitHub] the secrets, scoped to that environment
gh secret set DEPLOY_HOST  --env production --body '<host or IP>'
gh secret set DEPLOY_USER  --env production --body '<ssh user>'
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/eticket_deploy
ssh-keyscan -t ed25519 <host or IP> | gh secret set DEPLOY_KNOWN_HOSTS --env production
# optional: where the repo is cloned on the VM (default ~/e-ticketing)
gh variable set DEPLOY_PATH --env production --body '/home/<user>/e-ticketing'
```

Verify the keyscan fingerprint against the VM (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VM) before trusting it;
the workflow enforces `StrictHostKeyChecking=yes` against exactly that value. Manual deploy of a tag:
`gh workflow run deploy.yml --ref main -f tag=sha-<7>`.

## Operations

### Backups and restore

The `postgres-backup` CronJob runs daily at 03:00 UTC and writes `eticketing-<timestamp>.dump` (`pg_dump -Fc` of the
`eticketing` database only, not roles) into the `backups` PVC, keeping the 7 newest. The PVC lives on the same node disk as the
database, so this protects against a bad migration or a dropped table, **not** against losing the VM: copy dumps off the VM if that matters.
A failed dump can leave a `*.dump.tmp` file; delete it.

```bash
# [VM] run a backup now and list the dumps
kubectl -n eticketing create job --from=cronjob/postgres-backup backup-now
kubectl -n eticketing wait --for=condition=complete job/backup-now --timeout=120s
kubectl -n eticketing delete job backup-now
sudo ls -l /var/lib/rancher/k3s/storage/*_eticketing_backups/

# [VM] restore into the running database (replaces objects in the dump)
f=/var/lib/rancher/k3s/storage/<pvc dir>/eticketing-<timestamp>.dump
kubectl -n eticketing cp "$f" postgres-0:/tmp/restore.dump
kubectl -n eticketing exec postgres-0 -- pg_restore -U postgres -d eticketing --clean --if-exists /tmp/restore.dump
kubectl -n eticketing exec postgres-0 -- rm /tmp/restore.dump
kubectl -n eticketing rollout restart deploy
```

Stop writes first for a clean restore: `kubectl -n eticketing scale deploy --all --replicas=0`, then scale back to 1 afterwards.

### Password rotation

`00-roles.sh` runs only when the Postgres volume is empty, so changing a password in `infra/k8s/.env` does not change the
database roles. To rotate, change the role and the Secret together:

```bash
# [VM] 1. set the new role password (example: ledger owner; use the same value you put in .env)
kubectl -n eticketing exec -it postgres-0 -- psql -U postgres -d eticketing -c "ALTER ROLE ledger_owner PASSWORD '<new>'"
# 2. update the matching *_PASSWORD value in infra/k8s/.env (edit by hand; keep it URL-safe: A-Z a-z 0-9 . _ ~ -)
# 3. re-apply the Secret and restart the workloads so they read it
infra/k8s/scripts/apply-secrets.sh
kubectl -n eticketing rollout restart deploy
```

Roles: `<schema>_owner` (migrations) and `<schema>_app` (runtime) for `tickets`, `payments`, `ledger`; the superuser is `postgres`
(`POSTGRES_PASSWORD` is only read by the first initdb, rotate it with `ALTER ROLE postgres` too). Rotating `PUBLIC_API_KEY_*`,
`INTERNAL_API_KEY_*`, `JWT_SECRET` or the admin hash needs only steps 2 and 3.

If the Secret was first created by an older client-side `kubectl apply`, it carries a `last-applied-configuration` annotation holding the values.
Remove it once: `kubectl annotate secret eticket-secrets kubectl.kubernetes.io/last-applied-configuration- -n eticketing`.

### Upgrade, roll back

Deploy a newer tag with `deploy.sh sha-<7>` (or let CD do it). Roll back by deploying an older tag that still exists on GHCR. A new tag
re-runs the `migrate` initContainer; migrations are forward-only, so a rollback across a migration needs a restore from backup.

## Troubleshooting

```bash
kubectl get pods -n eticketing                                   # all Running/Ready? one replica each
kubectl describe pod <pod> -n eticketing                         # events: ImagePullBackOff, probe failures
kubectl logs deploy/ticket-service -n eticketing -c migrate      # migration init container (also payment-service, ledger-service)
kubectl logs deploy/gateway -n eticketing --tail=100             # JSON logs; look for correlationId
kubectl -n eticketing rollout status deploy/gateway              # or: kubectl rollout status statefulset/postgres -n eticketing
kubectl get ingress -n eticketing
```

| Symptom                                                         | Check                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImagePullBackOff`                                              | The package is private or the tag does not exist. Make it public; check the tag with `deploy.sh <tag>`                                                                                                                                                                                                                                  |
| Pod stuck in `Init:`                                            | `kubectl logs <pod> -c wait-postgres` (Postgres not ready) or `-c migrate` (SQL error, wrong password)                                                                                                                                                                                                                                  |
| Browser shows the Traefik default cert or a certificate warning | Traefik log: `kubectl logs -n kube-system deploy/traefik \| grep -i acme`. Usual causes: DNS does not point at the VM, port 80 blocked (cloud firewall and host `iptables`), HelmChartConfig not copied (step 5). The ACME data persists in the Traefik volume; Let's Encrypt rate-limits repeated failures, so fix DNS and ports first |
| 429 for every visitor                                           | Traefik sees a node IP: confirm `kubectl get svc traefik -n kube-system -o jsonpath='{.spec.externalTrafficPolicy}'` prints `Local`                                                                                                                                                                                                     |
| `deploy.sh`: image tag missing                                  | Run `Images` with `all=true` on `main` (step 7), or deploy a tag that has been built                                                                                                                                                                                                                                                    |
| `infra/k8s/.env` problems                                       | `infra/k8s/scripts/apply-secrets.sh --dry-run` lists key names and the first invalid one (never values)                                                                                                                                                                                                                                 |
