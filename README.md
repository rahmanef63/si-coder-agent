# SI Coder Agent — Modular Zero-Human Deployment

Deploy any full-stack app (Next.js + self-hosted Convex DB) with **zero human involvement** through Dokploy, GitHub, and (optional) Hostinger DNS. Modular per-domain skills, plus a one-shot monolithic deploy script.

## The skill family

After running `bash install.sh`, you get the slash commands below. **Implemented** ones do the work; **stub** ones are boilerplate-only and exit with code 2 until someone fills them in.

### Implemented

| Command | Domain | What it does |
|---|---|---|
| `/sc-all` | Orchestrator | End-to-end: repo + DNS + Dokploy + Convex + frontend + verify |
| `/sc-dokploy` | Dokploy | CRUD on projects/apps/compose/domains, audit, debug |
| `/sc-convex` | Convex self-hosted | Deploy, rotate admin key, set JWT env, probe `api-/site-/dash-` |
| `/sc-onboarding` | Setup | Scans env, prompts only for missing credentials, writes to `~/.bashrc` |

### Stubs (boilerplate, accepting contributions)

| Command | Domain | Planned scope |
|---|---|---|
| `/sc-cf` | Cloudflare | DNS A/CNAME, Workers, Pages, R2, Zero Trust tunnel |
| `/sc-stripe` | Payments | Products/prices, webhooks, customer portal, restricted keys |
| `/sc-resend` | Email | Domain verify + auto DKIM/SPF/DMARC, API keys, smoke send |
| `/sc-clerk` | Auth (alt) | Origins, JWT template `convex`, paired with Clerk MCP for code |
| `/sc-vercel` | Frontend (alt) | Project + env + domain + deploy, alt to Dokploy app |
| `/sc-supabase` | Backend (alt) | Project provision, migrations, edge functions, types gen |

### Suggested for the future (not stubbed yet)

`/sc-r2`, `/sc-storage` (generic S3), `/sc-sentry`, `/sc-posthog`, `/sc-monitor` (Uptime Kuma / Better Stack), `/sc-domains` (registrar abstraction over Hostinger/Porkbun/Namecheap), `/sc-mcp` (scaffold MCP server in a project), `/sc-google` (OAuth / Workspace), `/sc-railway`, `/sc-coolify`.

Same pattern always — drop a folder into `skills/`, register vars in `scan-env.js` + `onboard.js`, add `link_skill` to `install.sh`.

The legacy `/use-si-coder` monolith (`scripts/deploy.js`) remains available in parallel for users who prefer one-shot.

## Install

```bash
git clone https://github.com/rahmanef63/si-coder-agent.git
cd si-coder-agent
bash install.sh                  # symlinks skills/sc-* into ~/.claude/skills/
node bin/onboard.js              # interactive credential setup (non-AI)
source ~/.bashrc
```

Or, if you're driving via Claude / OpenClaw / Gemini:
```
/sc-onboarding
```
The AI will scan your env, ask only for what's missing, and write to `~/.bashrc`.

## Quick deploy (legacy one-shot)

```bash
cd ~/projects/<app_name>
node ~/projects/opensource/si-coder-agent/scripts/deploy.js \
  "$DOKPLOY_API_URL" "$DOKPLOY_API_KEY" "<PROJECT>" "<APP>" "$GITHUB_TOKEN" "<DOMAIN>"
```

## Modular usage

```bash
# Just deploy the Convex backend:
node skills/sc-convex/scripts/deploy-convex.js --project myproj --app myapp --domain mydomain.com --with-auth-keys

# Check Convex backend health:
node skills/sc-convex/scripts/check-backend.js --domain mydomain.com --admin-key "$CONVEX_ADMIN_KEY"

# Rotate Convex admin key:
node skills/sc-convex/scripts/rotate-admin-key.js --compose-name myapp-db --env-file ./.env

# Set JWT env on a running backend (CLI breaks on PEM):
node skills/sc-convex/scripts/set-auth-env.js --domain mydomain.com --admin-key "$CONVEX_ADMIN_KEY" --generate

# List all Dokploy projects:
node skills/sc-dokploy/scripts/projects.js list

# Audit stale domains across the whole Dokploy instance:
node skills/sc-dokploy/scripts/audit.js
node skills/sc-dokploy/scripts/audit.js --fix    # remove TRAEFIK_ME + DUPLICATE_HOST
```

## Repo layout

```
si-coder-agent/
├── SKILL.md           umbrella; points to sc-*
├── README.md
├── .env.example
├── install.sh         symlinks skills/sc-* into ~/.claude/skills/
├── lib/
│   ├── dokploy.js     Dokploy REST client + CRUD helpers
│   ├── github.js      GitHub REST + git push helpers
│   ├── hostinger.js   Hostinger DNS A-record sync
│   ├── convex.js      admin key / schema deploy / JWT keys / probe
│   └── env.js         env-string parse, merge, .bashrc append
├── skills/
│   ├── sc-all/SKILL.md
│   ├── sc-dokploy/
│   │   ├── SKILL.md
│   │   └── scripts/{_shared,projects,apps,compose,domains,audit,debug}.js
│   ├── sc-convex/
│   │   ├── SKILL.md
│   │   └── scripts/{deploy-convex,check-backend,rotate-admin-key,set-auth-env}.js
│   ├── sc-onboarding/
│   │   ├── SKILL.md
│   │   ├── scripts/scan-env.js
│   │   └── steps/{github,dokploy,convex,hostinger,cf,stripe,resend,clerk,vercel,supabase}.md
│   └── sc-{cf,stripe,resend,clerk,vercel,supabase}/   STUBS — boilerplate only
├── scripts/
│   └── deploy.js      legacy monolith (still functional)
└── bin/
    └── onboard.js     one-shot CLI wizard
```

## CORE MANDATES (shared across all sc-*)

1. **Self-Hosted Convex by default** — never silently swap to Clerk. Use `@convex-dev/auth`.
2. **`convex/_generated` committed** — never run codegen inside the Dockerfile.
3. **`npm install --yes --legacy-peer-deps`** — no interactive prompts.
4. **Idempotency** — duplicate domain create = no-op.
5. **Admin Key Sync** — Dokploy compose env + repo env file always match.
6. **Preserve your Dokploy control host** (the one in `DOKPLOY_API_URL`) — never rename it inside any script.
7. **Clerk MCP for Clerk apps** — `clerk` at `https://mcp.clerk.com/mcp`.
8. **Exact cloning** — replicate site layout, not a generic admin dashboard.

## Adding a new `/sc-*` domain

1. `mkdir skills/sc-<name>/{scripts}`
2. Write `skills/sc-<name>/SKILL.md` with frontmatter `name: sc-<name>` + `description:`
3. Put scripts under `skills/sc-<name>/scripts/*.js`. Import shared utils from `../../../lib/`.
4. Add domain-required vars to `skills/sc-onboarding/scripts/scan-env.js` → `DOMAIN_VARS`.
5. Add validator to `bin/onboard.js` → `VALIDATORS`.
6. Add a step doc at `skills/sc-onboarding/steps/<name>.md`.
7. Edit `install.sh` → add `link_skill "sc-<name>"`.
8. Re-run `bash install.sh`.

## FAQ

**Q: Site stuck loading?** Check your `Dockerfile` uses `ARG NEXT_PUBLIC_CONVEX_URL=<real-url>`, not a dummy.

**Q: Convex dashboard 401/404?** Run `/sc-convex` → `rotate-admin-key.js`. Admin key now lives in Dokploy compose env.

**Q: Dokploy shows old `*.traefik.me` domains?** Run `node skills/sc-dokploy/scripts/audit.js --fix`.

**Q: "Connection lost while action was in flight"?** See `skills/sc-convex/SKILL.md` — five common causes for self-hosted Dokploy.

**Q: `npx convex env set JWT_PRIVATE_KEY` errors on `--`?** Use `skills/sc-convex/scripts/set-auth-env.js` (REST API) instead.

## License

MIT — Created by Rahman EF.
