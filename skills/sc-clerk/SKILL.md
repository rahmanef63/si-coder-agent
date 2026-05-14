---
name: sc-clerk
description: "(STUB / NOT IMPLEMENTED YET) Clerk auth setup for projects that explicitly use Clerk instead of @convex-dev/auth. Configures instance, sets allowed origins, creates JWT template for Convex integration. Pairs with Clerk MCP (clerk @ mcp.clerk.com/mcp) for SDK snippet generation."
---

# /sc-clerk — Clerk auth (STUB)

> **Status:** boilerplate only. Use only when a project explicitly chooses Clerk over `@convex-dev/auth`.

## When to use

By default `/sc-all` and `/sc-convex` use `@convex-dev/auth`. Use `/sc-clerk` only when:
- The user explicitly requests Clerk.
- An existing project already uses Clerk and is being migrated/maintained.
- You want a managed auth UI without running self-hosted JWKS.

## Scope when implemented

- Read Clerk instance from `CLERK_SECRET_KEY` (Backend API).
- Configure allowed origins (`NEXT_PUBLIC_<app-url>` + dev origin).
- Create a JWT template named `convex` with the correct issuer claim so Convex can verify.
- Write `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` + publishable key to project `.env`.
- Set up Convex `auth.config.ts` with `providers: [{ domain: <clerk-issuer>, applicationID: 'convex' }]`.

## Env vars

| Var | Purpose |
|---|---|
| `CLERK_SECRET_KEY` | `sk_test_` or `sk_live_` Backend API key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_test_` or `pk_live_` Frontend key |
| `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` | `https://<issuer-domain>` |

## Suggested file layout

```
sc-clerk/
├── SKILL.md
└── scripts/
    ├── instance.js       # read instance config + origins
    ├── set-origins.js    # update allowed origins
    ├── jwt-template.js   # create the 'convex' JWT template
    └── sync-convex-auth-config.js  # write auth.config.ts in project
```

## Note on Clerk MCP

Once `clerk` MCP is installed (`https://mcp.clerk.com/mcp`), prefer it for SDK snippet generation, integration patterns, and SDK-version-specific advice. `/sc-clerk` handles **provisioning** (origins, JWT template, env setup); Clerk MCP handles **code patterns**.
