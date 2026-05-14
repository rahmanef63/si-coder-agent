---
name: si-coder
description: "Zero human involvement full-stack deployment to Dokploy. Umbrella skill that points to modular sc-* sub-skills (sc-all, sc-dokploy, sc-convex, sc-onboarding) plus the legacy monolithic deploy.js. The user can invoke /sc-all for end-to-end, /sc-convex or /sc-dokploy for narrower domain ops, or /sc-onboarding to set up credentials."
---

# si-coder-agent — Umbrella

This is the parent skill for the SI Coder family. After installing (see `install.sh`), the following slash commands are available:

| Command | Domain | Purpose |
|---|---|---|
| `/sc-all` | Orchestrator | End-to-end full-stack deploy (replaces legacy `/use-si-coder` monolith) |
| `/sc-dokploy` | Dokploy | CRUD on projects/apps/compose/domains, audit, debug |
| `/sc-convex` | Convex self-hosted | Deploy, rotate admin key, set JWT env, probe `api-/site-/dash-` |
| `/sc-onboarding` | Setup | Scan env, prompt only for missing credentials, write to `~/.bashrc` |
| `/sc-cf` | Cloudflare | (future) DNS + CDN automation |

The **legacy `/use-si-coder`** continues to work in parallel — it runs the monolithic `scripts/deploy.js` which still bundles GitHub + Dokploy + Convex + Hostinger DNS.

## Why modular?

- **Surgical ops** — change a Convex admin key without re-deploying the world
- **Discoverable** — `/sc-dokploy` makes Dokploy CRUD a first-class skill, not buried inside deploy.js
- **Composable** — `/sc-all` is the only consumer that pulls everything together
- **Onboarding-aware** — `/sc-onboarding` knows which `/sc-*` you ticked and asks for only what's missing

## CORE MANDATES (shared)

These apply across every sub-skill:

1. **Self-Hosted Convex by default**: never silently swap to Clerk. Use `@convex-dev/auth`.
2. **`convex/_generated` is committed**: don't run codegen inside Dockerfile.
3. **`npm install --yes --legacy-peer-deps`** — no interactive prompts.
4. **Idempotency**: duplicate domain creation = no-op, not error.
5. **Admin key sync rule**: Dokploy compose env + repo env file always match.
6. **Preserve `backend.rahmanef.com`** as the Dokploy control plane host (Rahman's server).
7. **Clerk MCP for Clerk apps**: if target uses Clerk, preserve it; use Clerk MCP (`clerk` at `https://mcp.clerk.com/mcp`).
8. **Exact cloning**: if user wants a clone of an existing site, fetch and replicate layout, not a generic dashboard.

## Repo layout

```
si-coder-agent/
├── SKILL.md           ← this file
├── README.md
├── .env.example
├── install.sh         ← symlinks each sc-* into ~/.claude/skills/
├── lib/               ← shared modules (Dokploy, GitHub, Hostinger, Convex, env)
├── skills/
│   ├── sc-all/SKILL.md
│   ├── sc-dokploy/{SKILL.md, scripts/}
│   ├── sc-convex/{SKILL.md, scripts/}
│   └── sc-onboarding/{SKILL.md, scripts/, steps/}
├── scripts/
│   └── deploy.js      ← legacy monolith, still functional
└── bin/
    └── onboard.js     ← one-shot CLI wizard (no AI needed)
```

## Deployment profile (placeholders only)

```bash
# GitHub
GITHUB_TOKEN=ghp_<your_token>

# Dokploy
DOKPLOY_API_URL=https://<your-dokploy-host>/api
DOKPLOY_API_KEY=<your_dokploy_api_key>

# Hostinger DNS (optional)
HOSTINGER_API_TOKEN=<your_hostinger_token>

# Clerk (only for explicitly-Clerk apps)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_<clerk_publishable_key>
CLERK_SECRET_KEY=sk_live_<clerk_secret_key>
NEXT_PUBLIC_CLERK_FRONTEND_API_URL=https://<clerk-issuer-domain>

# Convex self-hosted (filled in by deploy)
CONVEX_SELF_HOSTED_URL=https://<convex-api-domain>
CONVEX_SELF_HOSTED_ADMIN_KEY=<convex_admin_key>
NEXT_PUBLIC_CONVEX_URL=https://<convex-api-domain>
NEXT_PUBLIC_CONVEX_SITE_URL=https://<convex-site-domain>
```

Never store real keys or live hostnames inside skill examples or agent instructions — always placeholders.
