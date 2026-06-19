---
name: sc-convex
description: "Convex self-hosted operations on Dokploy. Deploy compose template, rotate admin key, push schema, configure @convex-dev/auth (JWT_PRIVATE_KEY + JWKS), and probe the three backend subdomains (api-, site-, dash-)."
---

# /sc-convex — Convex on Dokploy

Use this skill when the user wants to deploy, debug, or maintain a **self-hosted Convex backend** running on Dokploy. The repo lives at `https://github.com/rahmanef63/si-coder-agent`.

## NEVER ask the user to run Convex CLI by hand

For self-hosted Convex projects the Convex CLI (v1.27+) auto-detects the backend from `.env.local` (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`). The schema/function push happens automatically via the sc-git pre-push hook installed by `/sc-all`. **Do not** instruct the user to run `npx convex deploy`, `pnpm convex:deploy`, `convex:push`, or any Convex CLI command interactively. If the hook is not installed, install it yourself (`node ~/.claude/skills/sc-git/scripts/hook.js install --repo <name>`) instead of asking.

If the hook is genuinely unable to deploy (admin key invalid, backend unreachable), debug it with `scripts/check-backend.js` and fix root cause — do not punt the convex CLI call to the user.

## Pre-requisites
- `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` — Dokploy admin
- `CONVEX_ADMIN_KEY` (or generated on the fly from the running container)
- Optional `HOSTINGER_API_TOKEN` for DNS A-record automation

If anything is missing, route the user to `/sc-onboarding`.

## CORE MANDATES (LEARNED LESSONS)

1. **Self-Hosted Convex by default**: never silently swap to Clerk. ALWAYS use `@convex-dev/auth` for new projects unless the user explicitly asks for Clerk.
2. **`convex/_generated` is checked in**: never run `npx convex codegen` inside `Dockerfile`. Generate locally with `npx convex dev --once` and commit the folder.
3. **Admin Key Sync Rule**: when generating or rotating the admin key, update BOTH the Dokploy Compose env (`CONVEX_ADMIN_KEY`) and the repo's local env file in a single pass. Never leave them out-of-sync.
4. **PEM via REST, not CLI**: `npx convex env set JWT_PRIVATE_KEY "-----BEGIN..."` breaks because `--` is parsed as a flag. Use `scripts/set-auth-env.js` (admin REST `/api/update_environment_variables`) instead.
5. **`NEXT_PUBLIC_CONVEX_URL` at build time**: `NEXT_PUBLIC_*` is inlined at `next build`. If the Dockerfile uses a dummy URL, the deployed JS connects to the wrong server — see `## Dockerfile pattern` below.
6. **No Scrypt/bcrypt password hashing**: Dokploy proxy kills WebSocket at >60s. Use PBKDF2 (10k iter ≈ 50ms) via WebCrypto — see `## Password hashing` below.
7. **Route `auth:*` actions via HTTP**: WebSocket reconnect mid-flight aborts in-flight actions. Wrap the Convex client so `auth:*` goes via `ConvexHttpClient` — see `## Frontend pattern` below.

## Required env vars on the Convex backend

These live as Dokploy Compose env (NOT in `.env.local`):

| Variable | Format | Purpose |
|---|---|---|
| `JWT_PRIVATE_KEY` | PEM PKCS8 RSA | Signs JWT via `importPKCS8()` |
| `JWKS` | JSON `{"keys":[{...}]}` | Served at `/.well-known/jwks.json` |
| `CONVEX_SITE_ORIGIN` | URL | Maps to `process.env.CONVEX_SITE_URL` |
| `CONVEX_CLOUD_ORIGIN` | URL | Maps to `process.env.CONVEX_CLOUD_URL` |
| `INSTANCE_SECRET` | hex | Preserve across redeploys |
| `INSTANCE_NAME` | string | App name |

## Scripts

All scripts live in `~/.claude/skills/sc-convex/scripts/` (symlink from this repo).

### `deploy-convex.js`
Deploy or update a Convex compose service on Dokploy. Idempotent — finds existing compose by name or deploys the Convex template, then sets `api-/site-/dash-` domains + `INSTANCE_SECRET` + auth env.

```bash
node scripts/deploy-convex.js \
  --project <PROJECT_NAME> \
  --app <APP_NAME> \
  --domain <root-domain.tld> \
  [--with-auth-keys]   # also generate JWT_PRIVATE_KEY + JWKS
```

### `check-backend.js`
Probe `api-/site-/dash-` subdomains + `/version` + `/.well-known/jwks.json` + admin-key validity. Prints a status table.

```bash
node scripts/check-backend.js --domain <root-domain.tld> [--admin-key "$CONVEX_ADMIN_KEY"]
```

### `rotate-admin-key.js`
Generate a fresh admin key from the running backend container, write to Dokploy Compose env, optionally update local `.env`.

```bash
node scripts/rotate-admin-key.js --compose-name <APP_NAME>-db [--env-file ./.env]
```

### `set-auth-env.js`
Set `JWT_PRIVATE_KEY` and `JWKS` (and any extra vars) on a self-hosted backend via admin REST API. Avoids the CLI `--` parsing bug.

```bash
node scripts/set-auth-env.js --domain <root-domain.tld> --admin-key "$CONVEX_ADMIN_KEY" [--generate]
```

`--generate` makes new RS256 keypair; omit to pull from `JWT_PRIVATE_KEY` / `JWKS` env.

## Dockerfile pattern (`NEXT_PUBLIC_CONVEX_URL`)

```dockerfile
# ❌ WRONG — dummy URL inlined into JS
ENV NEXT_PUBLIC_CONVEX_URL=https://dummy-for-build.convex.cloud

# ✅ CORRECT — ARG default + ENV; Dokploy build-arg overrides
ARG NEXT_PUBLIC_CONVEX_URL=https://api-<appname>.<your-domain>
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
```

## Frontend pattern (`ConvexClientProvider.tsx`)

```tsx
"use client";
import { ConvexReactClient } from "convex/react";
import { ConvexHttpClient } from "convex/browser";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { type ReactNode, useState } from "react";

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(() => {
    const client = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const http = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const orig = client.action.bind(client);
    (client as any).action = (ref: any, args?: any) => {
      const name = (ref as any)?._name ?? String(ref);
      if (typeof name === "string" && name.startsWith("auth:")) return http.action(ref as any, args);
      return orig(ref, args);
    };
    return client;
  });
  return <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>;
}
```

## Password hashing (PBKDF2 via WebCrypto)

```typescript
// convex/auth.ts — inside Password({ ... })
crypto: {
  async hashSecret(password: string) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const hb = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 10000, hash: "SHA-256" }, km, 256);
    const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, "0")).join("");
    return `pbkdf2_${hex(salt)}_${hex(new Uint8Array(hb))}`;
  },
  async verifySecret(password: string, hash: string) {
    if (hash.startsWith("pt_")) return hash === `pt_${password}`;
    const parts = hash.split("_");
    if (parts[0] !== "pbkdf2" || parts.length !== 3) return false;
    const salt = new Uint8Array(parts[1].match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const hb = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 10000, hash: "SHA-256" }, km, 256);
    const hex = Array.from(new Uint8Array(hb)).map(b => b.toString(16).padStart(2, "0")).join("");
    return hex === parts[2];
  },
},
```

## "Connection lost while action was in flight" — diagnosis

WebSocket reconnect during in-flight action. The server may have completed the work (user visible in dashboard!) but the client never got the response. Common causes for self-hosted Dokploy, in order of likelihood:

| Cause | Symptom | Fix |
|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` dummy at build | Users in DB, browser errors | Fix Dockerfile (see above) |
| Missing `JWT_PRIVATE_KEY` on backend | Action crashes before creating user | `scripts/set-auth-env.js --generate` |
| Missing `JWKS` on backend | `/.well-known/jwks.json` returns 500 | `scripts/set-auth-env.js --generate` |
| Dokploy idle WS timeout | Error only after sitting | Route `auth:*` via HTTP (see above) |
| Scrypt/bcrypt timeout | Action >60s, proxy kills WS | Use PBKDF2 pattern (see above) |
