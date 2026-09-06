# Convex (self-hosted) credentials

No new env vars required by default — `sc-convex` uses Dokploy credentials to manage the compose service. The Convex admin key is generated automatically from the running backend container by `scripts/deploy-convex.js` and persisted to the Dokploy compose env as `CONVEX_ADMIN_KEY`.

## Optional `CONVEX_ADMIN_KEY`

Only set this if you want to use a pre-existing admin key from a backend you already deployed manually.

**Validator**: contains `|`, length ≥ 32.

## Test

After `sc-convex` runs at least once:
```bash
node skills/sc-convex/scripts/check-backend.js --domain <root.tld> --admin-key "$CONVEX_ADMIN_KEY"
```
