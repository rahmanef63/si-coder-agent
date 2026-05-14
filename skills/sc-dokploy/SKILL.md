---
name: sc-dokploy
description: "Dokploy CRUD, audit, and debug. List/create/update/delete projects, applications, compose services, and domains via REST API. Find stale domains, duplicate hosts, and *.traefik.me leftovers. Inspect status and recent deployments."
---

# /sc-dokploy — Dokploy CRUD & Audit

Use this skill when the user wants to inspect, change, or clean up Dokploy state directly (without redeploying code).

## Pre-requisites
- `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` — Dokploy admin

If missing, route to `/sc-onboarding`.

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
