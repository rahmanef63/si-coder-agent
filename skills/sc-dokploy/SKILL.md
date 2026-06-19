---
name: sc-dokploy
description: "Dokploy CRUD, audit, and debug. List/create/update/delete projects, applications, compose services, and domains via REST API. Find stale domains, duplicate hosts, and *.traefik.me leftovers. Inspect status and recent deployments."
---

# /sc-dokploy — Dokploy CRUD & Audit

Use this skill when the user wants to inspect, change, or clean up Dokploy state directly (without redeploying code).

## Pre-requisites
- `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` — Dokploy admin
- SSH fallback to the Dokploy host (for orphan swarm services / Traefik file CRUD the REST API does NOT expose): `ssh -i ~/.ssh/id_n8n rahman@srv614914` with passwordless sudo.

If missing, route to `/sc-onboarding`.

## REST vs SSH

Dokploy REST API covers projects, applications, compose, domains, deploy/start/stop, monitoring read. It does **NOT** cover:
- `docker service rm` (orphan swarm services)
- `rm /etc/dokploy/traefik/dynamic/<file>.yml` (orphan Traefik routers)
- container exec / kill / log tail beyond the dashboard

For those, SSH in directly. Useful one-liners:

```bash
ssh -i ~/.ssh/id_n8n rahman@srv614914 'sudo -n docker service ls'
ssh -i ~/.ssh/id_n8n rahman@srv614914 'sudo -n ls /etc/dokploy/traefik/dynamic/'
ssh -i ~/.ssh/id_n8n rahman@srv614914 'sudo -n docker service rm <name>'
ssh -i ~/.ssh/id_n8n rahman@srv614914 'sudo -n rm /etc/dokploy/traefik/dynamic/<name>.yml'  # Traefik file watcher reloads in ~5-10s
```

**Orphan-service pattern**: when a Dokploy app is recreated, the old swarm service and its Traefik dynamic config can survive deletion. Both compete for the same `Host(...)` rule. Symptom: prod serves an old image even after a fresh deploy. Diagnosis: `docker service ls` shows two services for the same project, and two `.yml` files in `traefik/dynamic/` bind the same domain. Fix: remove the orphan file + service.

## CORE RULES

1. **Idempotency**: `domain.create` may 4xx on duplicate; treat that as a no-op, not an error.
2. **Don't delete domains blindly**: only delete domains via `audit.js`'s `selectDomainsToDelete` — keep the desired canonical host, drop `*.traefik.me` and duplicates.
3. **Never rename the Dokploy control host**: whatever hostname is in `DOKPLOY_API_URL` is the control plane. Never rewrite it inside scripts — read it from env.
4. **`x-api-key` header, not Bearer**: Dokploy uses `x-api-key`, NOT `Authorization: Bearer`.

## Scripts

### `projects.js` — Project CRUD
```bash
node scripts/projects.js list
node scripts/projects.js create <name>
node scripts/projects.js show <name>
```

### `apps.js` — Application CRUD
```bash
node scripts/apps.js list --project <name>
node scripts/apps.js show --project <name> --app <name>
node scripts/apps.js deploy --project <name> --app <name>
```

### `compose.js` — Compose service CRUD
```bash
node scripts/compose.js list --project <name>
node scripts/compose.js show --compose <composeName>
node scripts/compose.js env --compose <composeName>
node scripts/compose.js deploy --compose <composeName>
```

### `domains.js` — Domain CRUD
```bash
node scripts/domains.js list-app --app-id <id>
node scripts/domains.js list-compose --compose-id <id>
node scripts/domains.js create-app --app-id <id> --host <host> [--port N] [--service NAME]
node scripts/domains.js delete --domain-id <id>
```

### `audit.js` — Sweep
Reports across all projects:
- `*.traefik.me` placeholder hosts that should be removed
- Duplicate hosts on the same service
- Applications with no domain configured
- Compose services missing INSTANCE_SECRET

```bash
node scripts/audit.js [--fix]   # --fix removes stale domains
```

### `debug.js` — Status & recent deployments
```bash
node scripts/debug.js status --project <name> --app <name>
node scripts/debug.js status --compose <composeName>
node scripts/debug.js deployments --app-id <id>
```

## API endpoint reference (Dokploy)

| Action | Endpoint | Method |
|---|---|---|
| List projects | `/project.all` | GET |
| Create project | `/project.create` | POST `{ name }` |
| Get application | `/application.one?applicationId=` | GET |
| Update application | `/application.update` | POST |
| Deploy application | `/application.deploy` | POST `{ applicationId }` |
| Get compose | `/compose.one?composeId=` | GET |
| Update compose | `/compose.update` | POST |
| Deploy compose | `/compose.deploy` | POST `{ composeId }` |
| Deploy compose template | `/compose.deployTemplate` | POST `{ environmentId, id }` |
| Create domain | `/domain.create` | POST |
| Delete domain | `/domain.delete` | POST `{ domainId }` |
| List GitHub providers | `/github.githubProviders` | GET |
| Save app GH provider | `/application.saveGithubProvider` | POST |

Auth: `x-api-key: <DOKPLOY_API_KEY>`.

## Note on logs

Dokploy build logs are NOT exposed over the REST API (as of this skill's last update). On deployment failure, point the user at the Dokploy dashboard:
`<DOKPLOY_API_URL without /api> → project → service → Deployments`
