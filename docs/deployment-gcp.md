# Live deployment record: Google Cloud (K3s on one VM)

This is how the live demo was actually deployed: a single Google Cloud Compute Engine VM running K3s, serving the
images CI published to GHCR, behind Traefik with a Let's Encrypt certificate on a free DuckDNS name. It follows the
generic guide [infra/k8s/README.md](../infra/k8s/README.md) and records the Google Cloud specifics, the choices made
and the problems hit on the way. Design rationale: [ADR-0011](adr/0011-deployment-k3s-single-vm.md) and
[ADR-0026](adr/0026-k3s-manifests-and-deploy.md).

No secret or private value is written here. Placeholders: `<PROJECT_ID>` (Google Cloud project), `<HOST>` (the
DuckDNS name), `<EMAIL>` (admin and Let's Encrypt contact), `<VM_IP>` (the reserved static IP), `<SHA>` / `sha-<7>`
(the released `main` commit and its image tag).

**Where each command runs.** `[laptop]` = your workstation, `[VM]` = the server over SSH, `[GitHub]` = repository
settings or `gh`.

## What runs where

| Layer      | Choice                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Cloud      | Google Cloud Compute Engine, zone `europe-west1-b`                                                                             |
| VM         | `e2-medium` (2 vCPU, 4 GB, x86-64), Ubuntu 24.04 LTS, 20 GB `pd-balanced` boot disk, labels `app=eticketing`, `purpose=demo`  |
| Network    | Reserved static external IP; firewall allows TCP 80 and 443 from anywhere, SSH 22                                              |
| DNS        | Free DuckDNS subdomain, `A` record to the static IP                                                                            |
| Kubernetes | K3s `v1.37.2+k3s1`, single node, bundled Traefik tuned by a `HelmChartConfig` (HTTPS redirect, Let's Encrypt, real client IP) |
| Workloads  | Namespace `eticketing`: Postgres StatefulSet, .NET Ticket Service, Payment, Ledger, Gateway, web (nginx), daily backup CronJob |
| Images     | `ghcr.io/zainelabdeen/e-ticketing/<name>:sha-<7>`, multi-arch, built by `.github/workflows/images.yml`; nothing is built on the VM |
| Secrets    | Generated on the VM into the git-ignored `infra/k8s/.env`; applied as the Secret `eticket-secrets`; never leave the VM        |

The application never runs on the VM's Node.js. Node is the operator toolchain only: it runs the scripts that
generate secrets, filter them into the Secret, render the production overlay, check GHCR and seed demo data.

## 1. Release and publish the images [GitHub]

The VM only pulls images, so they must exist and be public first.

```bash
gh pr create --base main --head dev --title "Release: …" --body "…"     # release PR dev -> main
gh pr checks --watch && gh pr merge --merge
gh workflow run images.yml --ref main -f all=true                      # seed: every image gets sha-<7> of this commit
gh api repos/ZainElabdeen/e-ticketing/commits/main -q .sha             # <SHA>; the tag is sha-<first 7>
```

Then make the eight GHCR packages public (GitHub, Packages, Package settings, Change visibility). There is no API for
this. Check anonymously that a tag is pullable:

```bash
T=$(curl -s "https://ghcr.io/token?scope=repository:zainelabdeen/e-ticketing/web:pull" | jq -r .token)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $T" \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://ghcr.io/v2/zainelabdeen/e-ticketing/web/manifests/sha-<7>        # 200
```

## 2. Separate gcloud configuration [laptop]

The workstation also holds a work Google account. A separate gcloud configuration keeps the two apart: logging in adds
an account, it never replaces one, and switching is instant.

```bash
gcloud config configurations create personal     # becomes active
gcloud auth login                                # pick the personal account in the browser
gcloud config set project <PROJECT_ID>
gcloud config set compute/zone europe-west1-b
gcloud config configurations list                # personal is marked active
```

Rules followed: never `gcloud auth application-default login` (it replaces the machine-wide default credentials other
tools use), never `gcloud auth revoke`, and pass `--configuration personal` to destructive commands so they cannot
run against the wrong account. Switching gcloud configurations does not change the `kubectl` context.

## 3. Choose the VM [laptop]

An existing VM in the project was checked first and rejected:

- port 80 was already served by another application's Docker stack, and K3s' Traefik needs ports 80 and 443;
- its disk was 97 % full, and K3s plus eight images and Postgres need about 10 GB; Kubernetes stops scheduling pods
  under disk pressure.

So the demo got its own small VM, which keeps the other workload untouched and can be stopped or deleted on its own.
`e2-micro` (the free one, 1 GB) is too small for K3s and six workloads; `e2-medium` is the smallest comfortable size.

```bash
gcloud compute addresses create eticket-vm-ip --region europe-west1
gcloud compute instances create eticket-vm \
  --zone europe-west1-b --machine-type e2-medium \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size 20GB --boot-disk-type pd-balanced \
  --address eticket-vm-ip --tags eticket --labels app=eticketing,purpose=demo
```

Ports 80 and 443: the project already had a firewall rule allowing them to every instance. In a fresh project add one:

```bash
gcloud compute firewall-rules create eticket-web --allow tcp:80,tcp:443 --target-tags eticket
```

SSH: the default rule allows port 22 from anywhere with key-only login. Restrict it to your own address when CD is not
used (`gcloud compute firewall-rules update default-allow-ssh --source-ranges=<your IP>/32`); CD from GitHub-hosted
runners needs port 22 reachable from GitHub's address ranges.

## 4. SSH access [laptop]

```bash
gcloud compute ssh eticket-vm --zone europe-west1-b     # first time: creates ~/.ssh/google_compute_engine, adds the key
```

Then a plain `ssh` alias in `~/.ssh/config`:

```
Host eticket-vm
  HostName <VM_IP>
  User <your-user>
  IdentityFile ~/.ssh/google_compute_engine
  IdentitiesOnly yes
```

Never add keys with `gcloud compute instances add-metadata … ssh-keys=…`: it replaces the whole key list.

## 5. DNS [laptop]

Create a DuckDNS subdomain and set its IP to `<VM_IP>`. Let's Encrypt (HTTP-01) needs it before the certificate can be
issued.

```bash
dig +short <HOST>      # prints <VM_IP>
```

## 6. Prepare the VM [VM]

```bash
sudo apt-get update && sudo apt-get install -y git curl xz-utils dnsutils libatomic1
```

`libatomic1` is missing from Google Cloud's minimal Ubuntu image, and the official Node.js build fails without it
(`libatomic.so.1: cannot open shared object file`).

K3s, with `kubectl` usable without sudo (the scripts call plain `kubectl`):

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION='v1.37.2+k3s1' sh -
mkdir -p ~/.kube && sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown "$USER" ~/.kube/config && chmod 600 ~/.kube/config
echo "KUBECONFIG=$HOME/.kube/config" | sudo tee -a /etc/environment && export KUBECONFIG=$HOME/.kube/config
kubectl get nodes                                    # Ready
```

Node.js 26 system-wide (non-interactive SSH, as used by CD, does not load nvm) and pnpm: see
[infra/k8s/README.md, step 3](../infra/k8s/README.md#3-install-k3s-vm) for the checksum-verified tarball install. Then:

```bash
node --version && pnpm --version                     # v26.x, 10.34.9
```

## 7. Repository, secrets and Traefik [VM]

Set the two non-secret values once per SSH session. Placeholders such as `<HOST>` typed literally break bash: `<` is
input redirection.

```bash
export HOST=<HOST> EMAIL=<EMAIL>

git clone https://github.com/ZainElabdeen/e-ticketing.git ~/e-ticketing
cd ~/e-ticketing && git checkout --detach <SHA>
pnpm install --frozen-lockfile

node infra/scripts/setup-local.mjs --env infra/k8s/.env --no-ports --email "$EMAIL"
printf 'HOST=%s\nACME_EMAIL=%s\n' "$HOST" "$EMAIL" >> infra/k8s/.env
```

`setup-local.mjs` writes every password, API key and the JWT secret into `infra/k8s/.env` (mode 600) and prints the
backoffice admin password once. Store the password in a password manager. The env file is never printed, copied or
committed. To fix a wrong `HOST` or `ACME_EMAIL` line without showing secrets:
`sed -i '/^HOST=/d;/^ACME_EMAIL=/d' infra/k8s/.env`, then append them again.

Traefik, configured once (HTTP to HTTPS 308, Let's Encrypt resolver, `externalTrafficPolicy: Local` so per-IP rate
limits see real clients):

```bash
node infra/k8s/scripts/render-prod.mjs --traefik --acme-email "$EMAIL"
sudo cp infra/k8s/.rendered/traefik-config.yaml /var/lib/rancher/k3s/server/manifests/traefik-config.yaml
kubectl -n kube-system rollout status deploy/traefik --timeout=300s
kubectl -n kube-system get svc traefik -o jsonpath='{.spec.externalTrafficPolicy}{"\n"}'   # Local
```

## 8. Deploy [VM]

```bash
infra/k8s/scripts/deploy.sh sha-<7>            # ends with: DEPLOY OK sha-<7>
kubectl get pods -n eticketing                 # every pod Running, 1/1
```

`deploy.sh` checks that all eight images exist on GHCR, applies the Secret, renders and applies the `prod` overlay
(Postgres, three services whose `migrate` initContainers run `prisma migrate deploy` first, gateway, web, two
Ingresses, backup CronJob) and waits for every rollout. Re-running it never re-initialises the database.

## 9. Verify and seed [laptop]

- `https://<HOST>/`: the shop; the first request can take a minute while the certificate is issued.
- `https://<HOST>/backoffice`: log in with `<EMAIL>` and the password printed in step 7.

Demo data through the public API (four purchases, card and QR, six tickets; not idempotent, run once):

```bash
SEED_GATEWAY_URL=https://<HOST>/api node infra/scripts/seed-demo.mjs      # ends with: SEED OK
```

Real client IPs (otherwise every visitor shares one rate-limit bucket): eleven rapid wrong-password logins must end in
`429`, while a login from a second network (a phone on mobile data) still works.

```bash
for i in $(seq 11); do curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<HOST>/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"nobody@example.org","password":"wrong-password"}'; done
```

## 10. Operate

| Task               | Command                                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| New release        | Merge to `main`, then `[VM]` `git fetch origin && git checkout --detach <new SHA> && infra/k8s/scripts/deploy.sh sha-<new 7>` (or enable `deploy.yml`, below) |
| Status             | `[VM]` `kubectl get pods -n eticketing`; logs `kubectl logs deploy/gateway -n eticketing --tail=50`                                       |
| Migration logs     | `[VM]` `kubectl logs <pod> -n eticketing -c migrate`                                                                                     |
| Certificate issues | `[VM]` `kubectl -n kube-system logs deploy/traefik --tail=50`                                                                            |
| Pause (save money) | `[laptop]` `gcloud compute instances stop eticket-vm --zone europe-west1-b --configuration personal`; `start` resumes, K3s restarts itself |
| Remove after demo  | `[laptop]` `gcloud compute instances delete eticket-vm --zone europe-west1-b --configuration personal`, then `gcloud compute addresses delete eticket-vm-ip --region europe-west1 --configuration personal` |

Automatic deploys (optional): create the GitHub environment `production` limited to `main`, add a dedicated deploy SSH
key to the VM, and set `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` as environment secrets.
Check first that `ssh <user>@<VM_IP> 'node --version && kubectl get nodes'` works non-interactively. Details:
[infra/k8s/README.md, Continuous deployment](../infra/k8s/README.md#continuous-deployment-optional).

Cost, approximate list prices for `europe-west1` (check the pricing calculator): `e2-medium` about USD 0.80 a day while
running; the 20 GB disk about USD 0.07 a day and the static IP a few cents a day, both also while stopped. About USD 7
for a week running continuously; stop the VM between demos and delete it afterwards.

## 11. Hardening, continuous deployment and backups (after the first deploy)

SSH on the VM [VM]: key-only authentication is the Google Cloud default; root login and keyboard-interactive login
were switched off with a drop-in, and fail2ban bans repeated failed SSH logins (its default `sshd` jail).

```bash
printf "PermitRootLogin no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\n" \
  | sudo tee /etc/ssh/sshd_config.d/60-eticket-hardening.conf
sudo sshd -t && sudo systemctl reload ssh
sudo apt-get install -y fail2ban && sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

Port 22 stays reachable from the internet on purpose: GitHub-hosted runners connect from many changing address
ranges, so continuous deployment over SSH cannot use an IP allow-list. Keys are the protection.

Continuous deployment [laptop, GitHub]: a dedicated deploy key, separate from the personal SSH key and revocable on
its own, installed with forwarding and terminal allocation disabled:

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/eticket_deploy -C eticket-deploy
# [VM] append to ~/.ssh/authorized_keys:
#   no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty <contents of eticket_deploy.pub>
ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/eticket_deploy <user>@<VM_IP> 'node --version && kubectl get nodes'
```

The GitHub environment `production` is limited to the `main` branch (deployment branch policy), so no other branch's
workflow can read its secrets:

```bash
gh api -X PUT repos/<owner>/<repo>/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/<owner>/<repo>/environments/production/deployment-branch-policies -f name=main -f type=branch
gh secret set DEPLOY_HOST --env production --body <VM_IP>
gh secret set DEPLOY_USER --env production --body <user>
gh secret set DEPLOY_SSH_KEY --env production < ~/.ssh/eticket_deploy
ssh-keyscan -t ed25519 <VM_IP> | gh secret set DEPLOY_KNOWN_HOSTS --env production
```

Proof: dispatching the `Deploy` workflow for the running tag (`gh workflow run deploy.yml --ref main -f tag=sha-<7>`)
ended with `DEPLOY OK sha-<7>`. From then on every push to `main` builds the images and deploys.

Backups [VM]: a manual run of the daily CronJob, then an integrity check of the newest dump with `pg_restore --list`:

```bash
kubectl -n eticketing create job --from=cronjob/postgres-backup backup-test
kubectl -n eticketing wait --for=condition=complete job/backup-test --timeout=180s
F=$(sudo sh -c 'ls -1t /var/lib/rancher/k3s/storage/*_eticketing_backups/eticketing-*.dump | head -1')
sudo cat "$F" | kubectl -n eticketing exec -i postgres-0 -- pg_restore --list | grep -c 'TABLE DATA'
kubectl -n eticketing delete job backup-test
```

The dump was written and lists every table's data. Restore steps: [infra/k8s/README.md](../infra/k8s/README.md).

Repository: `main` and `dev` are protected (pull request required; required checks `verify`, `test`, `test-int`,
`e2e`, `k3d`). SonarCloud analyses `main`, `dev` and pull requests for the TypeScript and the .NET projects.

## Problems hit and how they were solved

| Problem                                                                                     | Cause                                                                                              | Fix                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| CI `e2e`: contract suites could not load `@eticket/contracts/openapi/*.json`                | The JSON is a build output (`packages/contracts/dist`) and the job does not build                  | `infra/scripts/contract.sh` bundles the contracts first                                            |
| SonarCloud gate: new-code coverage 43 %                                                      | SonarCloud's whole-repo scope ignores `sonar.sources`, so tooling and test files counted as code   | Scope by `sonar.exclusions` and `sonar.coverage.exclusions`; scanner runs after `pnpm install`      |
| CI `k3d`: `SMOKE FAILED: web origin … 127.0.0.1:8080`                                        | The smoke test's web step fell back to the compose web port, absent on the runner                  | `k3d-e2e.sh` passes `SMOKE_WEB_URL` so both checks go through the ingress                          |
| Local k3d run: every pod `Pending`, "untolerated taint"                                     | Workstation disk above 90 %: the node gets a disk-pressure taint                                   | Free space (Docker build cache) or let CI prove it                                                 |
| Existing VM unsuitable                                                                      | Port 80 taken by another stack; disk 97 % full                                                     | Dedicated `e2-medium` VM                                                                           |
| `node: … libatomic.so.1: cannot open shared object file`                                     | Minimal Ubuntu image lacks `libatomic1`                                                            | `apt-get install libatomic1` (now in the guide)                                                    |
| `-bash: HOST: No such file or directory`                                                    | A `<HOST>` placeholder typed literally; bash read it as input redirection                          | Export real values once (`export HOST=…`) and use `"$HOST"`                                        |
| CD over SSH: `kubectl` "permission denied" on `/etc/rancher/k3s/k3s.yaml`                 | `KUBECONFIG` was exported in `~/.bashrc`, which non-interactive SSH skips; K3s' kubectl fell back to the root-only file | `KUBECONFIG` set system-wide in `/etc/environment` (now in both guides) |
| SonarCloud gate on `main`: path traversal in `render-prod.mjs`, `[` in `render.sh`        | Output paths came straight from CLI arguments                                                      | Output paths constrained to `infra/k8s` and the temp directory; `[[ ]]` in shell                   |

## What is deliberately not in the repository

The project ID, the account, the hostname, the IP, the admin email and password, and every generated secret. Secrets
live only in `infra/k8s/.env` on the VM (git-ignored, mode 600) and in the cluster Secret. Losing the VM means
regenerating them with `setup-local.mjs` and redeploying; the database comes back from a `pg_dump` in the backups
volume or starts empty.
