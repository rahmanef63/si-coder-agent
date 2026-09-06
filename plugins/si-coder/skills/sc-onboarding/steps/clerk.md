# Clerk credentials (STUB — for future /sc-clerk)

Only needed if your project explicitly uses Clerk instead of `@convex-dev/auth`.

## `CLERK_SECRET_KEY` (optional)

Backend API key. Use `sk_test_` for dev, `sk_live_` for prod.

**How to get one**: https://dashboard.clerk.com/~/api-keys (redirects to your last-active instance) → **Quick Copy** → **Secret key**. Server-side only, never expose.

**Validator**: starts with `sk_test_` or `sk_live_`.

## `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (optional)

Frontend key.

**How to get one**: same **API keys** page → **Quick Copy** → **Publishable key**: https://dashboard.clerk.com/~/api-keys

**Validator**: starts with `pk_test_` or `pk_live_`.

## `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` (optional)

The Clerk issuer URL, e.g. `https://clerk.your-app.com`. Required by `convex/auth.config.ts`.

**How to get one**: same **API keys** page (also on **Domains**): https://dashboard.clerk.com/~/api-keys

**Validator**: starts with `https://`.

## Note

Once set, install the Clerk MCP (`clerk` at `https://mcp.clerk.com/mcp`) and prefer it for SDK code snippets. `/sc-clerk` handles **provisioning**; Clerk MCP handles **code**.
