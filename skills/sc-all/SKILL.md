---
name: sc-all
description: "End-to-end zero-human full-stack deployment to Dokploy. Orchestrates sc-dokploy + sc-convex (and future sc-cf): create GitHub repo, push code, set up Dokploy project/app/compose, deploy self-hosted Convex backend, configure DNS, trigger build, poll until done. Equivalent to legacy /use-si-coder but composed of the modular sc-* skills."
---

# /sc-all — Full-stack zero-human deployment

Use this skill when the user wants to ship a fresh project end-to-end in one command. This is the modular replacement for the legacy `/use-si-coder` monolith — both remain available in parallel.

## Pre-requisites

Required env (see `/sc-onboarding` if any are missing):
- `GITHUB_TOKEN`
- `DOKPLOY_API_URL`, `DOKPLOY_API_KEY`
- `HOSTINGER_API_TOKEN` (optional but recommended)

The user's project directory must contain:
- A `Dockerfile` (for the frontend) — `ARG NEXT_PUBLIC_CONVEX_URL=...` pattern
- A `docker-compose.yml` (for Convex backend) — only if self-hosted Convex
- `convex/_generated/` committed (run `npx convex dev --once` first)

## CORE MANDATES

All mandates from `sc-convex` and `sc-dokploy` apply. Specifically:

1. **Self-Hosted Convex by default** — `@convex-dev/auth`, never Clerk unless requested.
2. **Build Safety** — `convex/_generated` committed; no codegen inside Dockerfile.
3. **No prompts** — `npm install --yes --legacy-peer-deps`.
4. **Idempotency** — duplicate domain creation = no-op; do not recreate existing services.
5. **Exact cloning** — if user wants a clone of an existing site, fetch and replicate layout.
6. **Admin Key Sync** — Dokploy env + repo env file always match.
7. **Preserve your Dokploy control host** (the one in `DOKPLOY_API_URL`) — never rename it inside any script.
8. **Clerk MCP for Clerk apps** — if target uses Clerk, preserve it; use Clerk MCP (`clerk` at `https://mcp.clerk.com/mcp`).

## Orchestration

`/sc-all` walks through these phases. Each phase delegates to a sub-skill or shared library:

### Phase 1 — Onboarding gate
If any required env var missing → run `/sc-onboarding` first.

### Phase 2 — GitHub
- `lib/github.js` → `ensureRepo()` (create private repo if missing)
- `lib/github.js` → `pushLocalRepo()` (init/commit/push via SSH)

### Phase 3 — Dokploy project
- `lib/dokploy.js` → `findOrCreateProject(project)`
- Detect `Dockerfile` / `docker-compose.yml` to choose Application vs Compose path

### Phase 4 — Convex backend (if `docker-compose.yml` exists)
Delegate to `sc-convex`:
- `scripts/deploy-convex.js --project <P> --app <A> --domain <D> --with-auth-keys`

### Phase 5 — Frontend application (if `Dockerfile` exists)
- `lib/dokploy.js` → `createApplication` if missing
- Bind to Dokploy GitHub provider if available, else raw Git URL
- Set `env` + `buildArgs` to inject `NEXT_PUBLIC_CONVEX_URL`
- Create main `<domain>` via `lib/dokploy.js` → `createDomain`
- `lib/dokploy.js` → `cleanupApplicationDomains` to remove stale duplicates / `traefik.me`
- `lib/dokploy.js` → `deployApplication` + poll until `applicationStatus === 'done' | 'error'`

### Phase 6 — Verify
- `sc-convex` → `scripts/check-backend.js` to probe `api-/site-/dash-` subdomains
- Print final URLs

## Quick run (legacy-compatible script)

The original monolith remains at `scripts/deploy.js`. It is still functional and parallel-supported:

```bash
cd ~/projects/<app_name>
node ~/projects/opensource/si-coder-agent/scripts/deploy.js \
  "$DOKPLOY_API_URL" "$DOKPLOY_API_KEY" "<PROJECT>" "<APP_NAME>" "$GITHUB_TOKEN" "<DOMAIN>"
```

## Failure modes (where to look)

| Symptom | Where |
|---|---|
| `applicationStatus: error` | Dokploy dashboard → service → Deployments (logs are dashboard-only) |
| Convex auth crash | `sc-convex` SKILL — "Connection lost while action was in flight" table |
| DNS not resolving | `lib/hostinger.js` log output; check Hostinger portfolio coverage |
| Domain rejected | already exists, treat as no-op |
| `--` parsing breaks CLI | use `scripts/set-auth-env.js` (REST), not `npx convex env set` |
