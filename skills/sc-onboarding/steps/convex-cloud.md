# Convex Cloud credentials

## `CONVEX_DEPLOY_KEY` (required)
Production deploy key for your Convex **Cloud** project.
**How to get one**: https://dashboard.convex.dev/deployment/settings → pick the **production** deployment → **General** tab → "Generate Production Deploy Key", enable the `deployment:deploy` permission, copy.
Headless (for scripts): `npx convex login` then `npx convex deployment token create ci`.
Format: `prod:<deployment-name>|eyJ2...`. Treat as a SECRET — never commit or log.
**Validator**: contains `|`, starts with `prod:`/`preview:`/`project:`, length ≥ 32.

## `CONVEX_DEPLOYMENT` (optional)
Local-dev marker written by `npx convex dev`. NOT used in CI. Leave blank for online deploys.
**Validator**: length ≥ 6.

## Test
After a deploy, probe the deployment:
```bash
node skills/sc-convex-cloud/scripts/check-cloud.js --url https://<name>.convex.cloud
```
