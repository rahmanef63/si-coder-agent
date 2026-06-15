---
name: sc-vercel
description: "Vercel deploy as online frontend host. Create project bound to a GitHub repo, set CONVEX_DEPLOY_KEY, set build command to couple Convex Cloud deploy + Next.js build (injects NEXT_PUBLIC_CONVEX_URL), add a custom domain or subdomain, configure Hostinger DNS (CNAME for subdomain / A for apex) from Vercel's required config, trigger + poll deploy. Pairs with /sc-convex-cloud for the Convex Cloud backend."
---

# /sc-vercel — Vercel (online frontend)

> **Status:** implemented (online path).

## When to use

- You want Vercel's edge network for the Next.js frontend, with the Convex backend on **Convex Cloud** (managed).
- You don't want to deal with a Dockerfile / Compose for the frontend.
- The online counterpart to the self-hosted Dokploy path. Pair with `/sc-convex-cloud` for the backend.

## Scope (implemented)

`scripts/deploy.js` is a single 12-step orchestrator:

1. Build a team-aware Vercel client from `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`).
2. Resolve the GitHub repo: `--git-owner/--git-repo`, else read `origin` from the local git remote.
3. `findOrCreateProject({ name, gitRepo, framework:'nextjs' })` — bind the repo on create.
4. Set env vars: `CONVEX_DEPLOY_KEY` (`type:'encrypted'`, **Production only** — it's a prod key). Do **not** set `NEXT_PUBLIC_CONVEX_URL` (injected by the build).
5. Set the coupled build command (below) so Convex Cloud deploys first and injects the URL.
6. Add the custom domain/subdomain (tolerate 409 already-assigned).
7. Read the exact required DNS from Vercel's domain config.
8. Configure Hostinger DNS (TXT ownership challenge first if unverified, then the A/CNAME pointing record), or print the records to add manually if no `HOSTINGER_API_TOKEN`.
9. Trigger the first deploy (git-linked projects auto-deploy on push; force the initial one).
10. Poll `getDeployment` every 4s until `readyState ∈ {READY, ERROR, CANCELED}`.
11. Soft-poll DNS propagation (`misconfigured === false`) up to ~60s — never hard-fail (cert/record can lag).
12. Print summary: project id, deployment URL, custom domain, DNS record applied, Convex Cloud URL.

## Env vars

| Var | Required | Purpose |
|---|---|---|
| `VERCEL_TOKEN` | yes | Personal access token, https://vercel.com/account/tokens |
| `VERCEL_TEAM_ID` | optional | For team-scoped projects; appended as `?teamId=` to every API call |
| `CONVEX_DEPLOY_KEY` | yes | Convex Cloud **production** deploy key. Set on Vercel as encrypted, Production-only. NEVER logged |
| `HOSTINGER_API_TOKEN` | optional | Enables automatic DNS record writes. Without it, the records are printed for manual entry |

## Build command

Set verbatim on the project so the Convex Cloud deploy runs **before** the Next.js build and injects the URL:

```
npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
```

**Mandate:** do **NOT** also hand-set `NEXT_PUBLIC_CONVEX_URL` in Vercel for the same env — the `--cmd` injection is the single source of truth. The `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` override is required because Next.js only exposes `NEXT_PUBLIC_`-prefixed vars to the browser (the default injected `CONVEX_URL` never reaches the client).

## DNS logic

Read live from Vercel's domain config; do not hardcode:

- **Subdomain** (e.g. `app.example.com`) → `CNAME` to `recommendedCNAME[0].value` (fallback `cname.vercel-dns.com`).
- **Apex** (e.g. `example.com`) → `A` to the first IP of `recommendedIPv4[rank=1].value` (an array; pick `value[0]`, fallback `76.76.21.21`).
- **TXT** ownership challenge from `verification[]` when the domain reports `verified:false` — added first, then `verifyDomain` is called.

`CONVEX_DEPLOY_KEY` is a secret: passed via env to the Vercel encrypted env, and never echoed by any script. Only `NEXT_PUBLIC_CONVEX_URL` (public) is printed.

## Scripts

```
node skills/sc-vercel/scripts/deploy.js \
  --project myapp --app myapp --domain app.example.com \
  --git-owner rahmanef63 --git-repo myapp --prod
```

| Flag | Meaning |
|---|---|
| `--project <name>` | Vercel project name (defaults to `--app` if omitted) |
| `--app <name>` | Logical app name (defaults to `--project`) |
| `--domain <host>` | Full host to attach — apex `example.com` OR subdomain `app.example.com` |
| `--git-owner <o>` / `--git-repo <r>` | GitHub `owner/name`; if absent, read from `git remote get-url origin` |
| `--ref <branch>` / `--branch <branch>` | Git ref/branch to deploy; if absent, derived from `git rev-parse --abbrev-ref HEAD`, else `main` (use this for `master`-default repos) |
| `--prod` | Deploy the production target / alias |
| `--decoupled` | Opt-out of coupled build: set `NEXT_PUBLIC_CONVEX_URL` from env instead of `--cmd` injection |
| `--cwd <path>` | Working dir for git-remote resolution (default: process cwd) |

## File layout

```
sc-vercel/
├── SKILL.md
└── scripts/
    ├── _shared.js   # getClient (VERCEL_TOKEN/VERCEL_TEAM_ID) + parseArgs
    └── deploy.js    # 12-step orchestrator (project + env + build + domain + DNS + deploy)
```

> Note: the old "suggested file layout" with separate `project.js` / `env.js` / `domain.js` is superseded — project/env/domain/deploy are consolidated into `deploy.js` on top of the `lib/vercel.js` client.

## Implementation notes

- API base: `https://api.vercel.com`; auth `Authorization: Bearer <VERCEL_TOKEN>`; team projects append `?teamId=<VERCEL_TEAM_ID>` to every URL.
- A git-linked project only auto-deploys if the **Vercel GitHub App** is installed on the repo/org. `deploy.js` cannot install it headlessly; a `triggerDeploy` 403 surfaces a clear hint to install the App.
- Cross-skill: `/sc-all --target vercel` skips the Dokploy app + self-hosted Convex; it uses `/sc-convex-cloud` + `/sc-vercel` instead.
