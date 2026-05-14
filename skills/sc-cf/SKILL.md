---
name: sc-cf
description: "(STUB / NOT IMPLEMENTED YET) Cloudflare automation — DNS A/AAAA/CNAME records as a Hostinger alternative, Workers/Pages deploy, R2 bucket provisioning, Zero Trust tunnel setup. Mirrors the lib/hostinger.js surface so /sc-all can swap providers via a flag."
---

# /sc-cf — Cloudflare (STUB)

> **Status:** boilerplate only. No working scripts yet. Open a PR or implement the TODOs below to fill in.

## Scope when implemented

- **DNS** — create A/CNAME records for `<root>`, `api-<root>`, `site-<root>`, `dash-<root>`. Drop-in replacement for `lib/hostinger.js`.
- **Workers** — deploy a worker from `wrangler.toml`.
- **Pages** — connect a GitHub repo as a Pages project (alternative to Dokploy for static sites).
- **R2** — provision a bucket + access key, write to project env.
- **Zero Trust tunnel** — optional `cloudflared` tunnel to expose a local service.

## Env vars (already registered in `scan-env.js`)

| Var | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token with `Zone:Read`, `Zone:DNS:Edit`, `Account:Workers:Edit`, `Account:R2:Edit` |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID, copy from the dashboard right sidebar |

## Suggested file layout

```
sc-cf/
├── SKILL.md            (this file)
└── scripts/
    ├── dns.js          # CRUD A/AAAA/CNAME via /zones/<id>/dns_records
    ├── deploy-pages.js # POST /accounts/:id/pages/projects + bind to GitHub
    ├── deploy-worker.js
    ├── r2-bucket.js    # POST /accounts/:id/r2/buckets
    └── tunnel.js       # cloudflared tunnel create/route
```

## Implementation notes

- API base: `https://api.cloudflare.com/client/v4`
- Auth header: `Authorization: Bearer <CLOUDFLARE_API_TOKEN>`
- Errors return `{ success: false, errors: [{code, message}] }` — wrap in `lib/cloudflare.js` (TODO).
- Zone ID resolution: `GET /zones?name=<root-domain>` returns the zone — cache it.
- When `/sc-all` calls a DNS provider, prefer `sc-cf` if `CLOUDFLARE_API_TOKEN` is set, else fall back to `lib/hostinger.js`.

See `lib/hostinger.js` for the contract `/sc-all` expects a DNS module to expose: `configureDns({ fullDomain, dokployApiUrl, hostingerToken })`.
