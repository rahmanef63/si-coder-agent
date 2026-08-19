---
name: sc-help
description: "Quick-reference card for the whole SI-Coder /sc-* skill bundle — every command, the three /sc-all deploy targets (dokploy | hybrid | vercel), and the env each one needs. One-shot display, not a persistent mode. Trigger on /sc-help, 'sc help', 'list sc commands', 'what sc-* skills', 'which deploy target', 'si-coder help'."
---

# /sc-help — SI-Coder quick reference

## `sc` — the provider console (new)

| Command | What it answers |
|---|---|
| `sc providers` | which providers are configured, and what is missing |
| `sc providers show <id>` | every var for one provider + where to get it |
| `sc providers set <id>` | re-enter / rotate one provider's credentials |
| `sc providers rm <id> --yes` | drop its vars from the `~/.bashrc` managed block |
| `sc setup [--target t]` | interactive wizard for whatever is missing |
| `sc doctor [--target t]` | **live** — calls each real API and names what it reached |
| `sc preflight --target t` | the gate `/sc-all` runs before touching anything |

`providers` = configured (presence + format). `doctor` = actually works (real API call).

| `sc user` | profiles, and which folder uses which |
| `sc user which` | why this directory resolves to that profile |
| `sc user add <n> [--from-shell]` | create a profile (optionally import current env) |
| `sc user map <folder> <n>` | bind a folder + children to a profile |
| `sc env` / `sc run -- <cmd>` | apply the resolved profile to a shell / one command |

Multiple identities on one machine: credentials in `~/.config/si-coder/profiles/<n>.env`,
the folder map in `~/.config/si-coder/sc.md`. Longest matching path wins. A profile
**overrides** the shell and **removes** credentials it does not own — `--no-profile` opts out.

Run `sc` with no arguments for an arrow-key menu. Any command that picks a provider or a
target opens a list instead of asking you to type the name: `↑/↓` move, `Space` toggle
(multi-select), `a` all/none, `Enter` confirm, `Esc` cancel.

One-shot cheat sheet for the `/sc-*` deploy bundle. Show this, then route the user to the
specific skill. Not a mode — display and stop.

## Deploy targets (`/sc-all --target …`)

Same flow shape everywhere: `GitHub → backend → frontend → DNS → verify`. Pick by where things run.

| `--target` | Frontend | Backend | Env needed | Pick when |
|---|---|---|---|---|
| `dokploy` (default) | Dokploy app (your VPS) | Convex **self-hosted** (compose on Dokploy) | `DOKPLOY_*` + `GITHUB_TOKEN` | own the box, $0 marginal, full control |
| `hybrid` | Dokploy app (your VPS) | Convex **Cloud** (managed) | `DOKPLOY_*` + `GITHUB_TOKEN` + `CONVEX_DEPLOY_KEY` | app on your box, DB managed — no compose to babysit |
| `vercel` | Vercel (managed edge) | Convex **Cloud** (managed) | `VERCEL_TOKEN` + `GITHUB_TOKEN` + `CONVEX_DEPLOY_KEY` | managed edge, no VPS to babysit |

`HOSTINGER_API_TOKEN` is optional on all three (DNS automation). `hybrid` needs **no**
`docker-compose.yml` — the backend is a managed `*.convex.cloud` deployment; only the
frontend domain gets DNS. For a preview/project Convex key, also export `NEXT_PUBLIC_CONVEX_URL`.

```bash
/sc-all --target dokploy    # or just /sc-all
/sc-all --target hybrid
/sc-all --target vercel
```

## Skill catalog

| Command | Status | What it does |
|---|---|---|
| `/sc-all` | ✅ | Umbrella orchestrator — end-to-end deploy; `--target dokploy\|hybrid\|vercel` |
| `/sc-dokploy` | ✅ | Dokploy CRUD/audit/debug: projects, apps, compose, domains, stale-domain audit |
| `/sc-convex` | ✅ | Convex **self-hosted** on Dokploy: deploy, rotate admin key, JWT auth, probe `api-/site-/dash-` |
| `/sc-convex-cloud` | ✅ | Convex **Cloud** (managed) deploy; coupled build injects `NEXT_PUBLIC_CONVEX_URL`; probe `*.convex.cloud` |
| `/sc-vercel` | ✅ | Vercel online frontend: GitHub-bound project, Convex-coupled build, custom domain, Hostinger DNS |
| `/sc-git` | ✅ | GitHub repo CRUD + Actions cost reduction: audit burn, disable YAML, local CI, pre-push hook, VPS runner/cron |
| `/sc-onboarding` | ✅ | Credential wizard — scans env, asks only for missing, writes `~/.bashrc`. Non-AI: `node bin/onboard.js` |
| `/sc-sync` | ✅ | Tailscale rsync of gitignored files between VPS and local (same repo shared via git) |
| `/sc-n8n` | ✅ | Drive the self-hosted n8n instance via `@n8n/cli` (workflows, executions, credentials) |
| `/sc-cf` | 🚧 stub | Cloudflare — DNS (Hostinger alt), Workers/Pages, R2, Zero Trust tunnel |
| `/sc-stripe` | 🚧 stub | Payments — products/prices, webhooks, customer portal, restricted keys |
| `/sc-resend` | 🚧 stub | Email — domain verify (DKIM/SPF/DMARC), API keys, template send |
| `/sc-clerk` | 🚧 stub | Auth (alt) — origins, JWT template for Convex, paired with Clerk MCP |
| `/sc-supabase` | 🚧 stub | Backend (alt) — project provision, migrations, edge functions, types gen |
| `/use-si-coder` | ✅ (legacy) | One-shot monolith umbrella (runs repo-root `scripts/deploy.js`; secrets via env only) |

Stubs exit code `2` until implemented.

## Common entry points

- **Never deployed here before?** → `/sc-onboarding` (writes `~/.bashrc`), then `/sc-all --target <…>`.
- **Fresh full-stack ship, one command** → `/sc-all --target dokploy|hybrid|vercel`.
- **Just the backend** → `/sc-convex` (self-hosted) or `/sc-convex-cloud` (managed).
- **Existing self-hosted project, want push-to-deploy** → `/sc-all` installs the sc-git pre-push hook; after that `git push` auto-deploys Convex. Never run `npx convex deploy` by hand.
- **Cut GitHub Actions cost** → `/sc-git` (local/VPS CI instead of cloud minutes).

## Code quality vs. deploy orchestration

`/sc-*` owns **where** it runs + secrets/DNS. For **how the code is written**, consult the Claude
Code plugin skills (don't duplicate): `convex:*` (validators, function syntax, `@convex-dev/auth`)
and `vercel:*` / `vercel:nextjs` (App Router, Cache Components, build). See `sc-all` SKILL.md.
