---
name: sc-convex-cloud
description: "Convex Cloud (managed) deploy operations. Run 'npx convex deploy' against a Cloud deployment using CONVEX_DEPLOY_KEY, output the injected NEXT_PUBLIC_CONVEX_URL, and probe the *.convex.cloud deployment (/version + JWKS). The online-path counterpart to /sc-convex (self-hosted on Dokploy)."
---

# /sc-convex-cloud — Convex Cloud (managed)

Use this skill when the user wants to deploy, debug, or maintain a **Convex Cloud (managed)** backend — the online-path counterpart to `/sc-convex` (self-hosted on Dokploy). The repo lives at `https://github.com/rahmanef63/si-coder-agent`.

## NEVER ask the user to run Convex CLI by hand

All Convex Cloud deploys go through `scripts/deploy-cloud.js`. **Do not** instruct the user to run `npx convex deploy` interactively, nor to hand-set `NEXT_PUBLIC_CONVEX_URL`. The deploy key is passed via the script's `env` and never echoed. If a deploy fails, debug it with `scripts/check-cloud.js` and fix root cause — do not punt the Convex CLI call to the user.

## Pre-requisites
- `CONVEX_DEPLOY_KEY` — production (or preview) deploy key for the Cloud deployment. **Required.**
- `CONVEX_DEPLOYMENT` — optional local-dev marker written by `npx convex dev`. **NOT used in CI.**

If `CONVEX_DEPLOY_KEY` is missing, route the user to `/sc-onboarding`.

## CORE MANDATES (LEARNED LESSONS)

1. **Coupled build is the source of truth for the URL**: let `npx convex deploy --cmd '<build>'` inject `NEXT_PUBLIC_CONVEX_URL` at build time. Never hardcode the URL in two places — the `--cmd` injection wins.
2. **Next.js needs the `NEXT_PUBLIC_` prefix override**: the default injected var is `CONVEX_URL`, which never reaches the browser. ALWAYS pass `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`.
3. **Deploy key is a secret**: never log/echo it. Pass it via the process `env`, never interpolate it into a shell command string.
4. **Set `CONVEX_DEPLOY_KEY` only on the matching env**: a prod key → Production only; a preview key → Preview only. Never set `CONVEX_DEPLOYMENT` in CI.
5. **Project + key creation is human-one-time**: there is no anonymous Cloud-project create API. Mint keys headlessly only after a first interactive login (`npx convex deployment token create <name> --prod --save-env`).

## Required env vars

| Variable | Format | Purpose |
|---|---|---|
| `CONVEX_DEPLOY_KEY` | `prod:<name>\|eyJ2…` or `preview:…` | Authenticates `npx convex deploy` against the Cloud deployment (SECRET) |
| `CONVEX_DEPLOYMENT` | `prod:<name>` / deployment name | Optional local-dev marker only; leave blank in CI |

## Scripts

All scripts live in `skills/sc-convex-cloud/scripts/` (repo-relative; the usage blocks below assume this cwd). On install, this skill is symlinked into `~/.claude/skills/sc-convex-cloud/`, so the same paths resolve there too.

### `deploy-cloud.js`
Run a Convex Cloud deploy. Coupled build (default) runs the frontend build via `--cmd` and injects `NEXT_PUBLIC_CONVEX_URL`; `--backend-only` pushes just the backend (when Vercel runs the coupled build itself). Prints `NEXT_PUBLIC_CONVEX_URL=<url>` — never the deploy key.

```bash
node scripts/deploy-cloud.js \
  [--build-cmd 'npm run build'] \
  [--url-env NEXT_PUBLIC_CONVEX_URL] \
  [--backend-only] \
  [--message "deploy message"] \
  [--cwd <path>]
```

### `check-cloud.js`
Probe a Cloud deployment's `/version` + `/.well-known/jwks.json`. Derives the URL from `CONVEX_DEPLOY_KEY` when `--url` is omitted. Prints a status table; exits 2 if any probe is not ok.

```bash
node scripts/check-cloud.js --url https://<name>.convex.cloud
# or, deriving from the prod deploy key:
node scripts/check-cloud.js
```

## Diagnosis

| Symptom | Cause | Fix |
|---|---|---|
| Client connects to wrong backend | `NEXT_PUBLIC_CONVEX_URL` not injected | Ensure `--cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL` is set on the coupled build |
| Browser shows `CONVEX_URL` unset | Missing `NEXT_PUBLIC_` prefix override | Pass `--url-env NEXT_PUBLIC_CONVEX_URL` (default) — never the bare `CONVEX_URL` |
| `/.well-known/jwks.json` returns 500 | `@convex-dev/auth` keys not configured on the Cloud deployment | Configure JWT keys on the Cloud deployment via the dashboard / env |
| `deploy-cloud.js` exits 1 immediately | `CONVEX_DEPLOY_KEY` missing | Set it (route to `/sc-onboarding`) — never run the CLI by hand |
| `check-cloud.js` cannot derive URL | preview key (branch-derived name not in key) | Pass `--url https://<name>.convex.cloud` explicitly |
