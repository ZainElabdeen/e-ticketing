# ADR-0011: Deploy on K3s on one free-tier ARM VM, Traefik + Let's Encrypt, DuckDNS

## Context

The challenge requires the system to be deployed online (free tier or
Kubernetes, K3s preferred), allows a free domain, and scores a live demo. The
stack is Postgres + 4 backend services + nginx for the SPA. A 1 GB free-tier
instance cannot run K3s plus that stack.

## Decision

- **Host**: one Oracle Cloud Always Free Ampere A1 VM (ARM64, 4 OCPU, 24 GB
  RAM).
- **Orchestration**: K3s (single node) with its bundled Traefik ingress.
- **TLS**: Traefik ACME resolver with Let's Encrypt (HTTP-01).
- **Domain**: a free DuckDNS subdomain pointing at the VM's public IP.
- **Images**: multi-arch (amd64 + arm64) built in GitHub Actions, pushed to
  GHCR.
- **Data**: Postgres as a StatefulSet on K3s local-path storage; bootstrap and
  migrations as K8s Jobs before the services.
- **Ingress**: `/api/*` → gateway (prefix stripped), everything else → web.
- **Early skeleton**: deploy a minimal end-to-end slice as soon as Phase 2
  works, rather than first deploying at Phase 9.

## Alternatives

- **docker compose on a VM**: simplest and fully acceptable to the challenge,
  but K3s is the stated preference and the manifests are reviewable.
- **AWS EC2 free tier (t2/t3.micro, 1 GB)**: too small for K3s and the stack.
- **Managed Kubernetes**: not free.
- **noip.com**: also allowed; DuckDNS needs no monthly confirmation.

## Trade-off

Single node: no high availability, data on one disk, and Oracle may reclaim
idle free instances. Accepted for a demo; backups are a `pg_dump` CronJob.
ARM64 requires multi-arch images, which also makes the images run on Apple
Silicon dev machines.
