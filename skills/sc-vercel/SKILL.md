---
name: sc-vercel
description: "(STUB / NOT IMPLEMENTED YET) Vercel deploy as alternative frontend host to Dokploy. Create project, bind GitHub repo, set env vars (including NEXT_PUBLIC_CONVEX_URL pointing at the Dokploy-hosted Convex backend), trigger build. Useful when only the Next.js frontend wants Vercel's edge while the Convex backend stays self-hosted on Dokploy."
---

# /sc-vercel — Vercel (STUB)

> **Status:** boilerplate only.

## When to use

- You want Vercel's edge network for the frontend, but keep Convex self-hosted on Dokploy (your VPS).
- You don't want to deal with Dockerfile / Compose for the frontend.

## Scope when implemented

- Create a Vercel project bound to the GitHub repo (re-using `lib/github.js` for the push).
- Set env vars: `NEXT_PUBLIC_CONVEX_URL` pointing at `https://api-<domain>`.
- Trigger a deploy and poll until ready.
- Add custom domain via Vercel + cross-check DNS with `sc-cf` or `lib/hostinger.js`.

## Env vars

| Var | Purpose |
|---|---|
| `VERCEL_TOKEN` | Personal access token, https://vercel.com/account/tokens |
| `VERCEL_TEAM_ID` | Optional, for team-scoped projects |

## Suggested file layout

```
sc-vercel/
├── SKILL.md
└── scripts/
    ├── project.js   # create/find project, bind GH
    ├── env.js       # set env vars for production/preview
    ├── domain.js    # add custom domain
    └── deploy.js    # trigger + poll
```

## Implementation notes

- API base: `https://api.vercel.com`
- Auth: `Authorization: Bearer <VERCEL_TOKEN>`
- For team projects, append `?teamId=<VERCEL_TEAM_ID>` to every URL.
- Cross-skill: if `/sc-vercel` is the chosen frontend, `/sc-all` should skip the Dokploy Application phase and only run the Convex compose phase.
