# Dokploy credentials

## `DOKPLOY_API_URL` (required)

The base URL of your Dokploy admin API. Always ends with `/api` — the scripts auto-append it if missing.

Examples:
- `https://backend.example.com/api`
- `https://dokploy.mydomain.com/api`

**Validator**: starts with `https://`.

## `DOKPLOY_API_KEY` (required)

The Dokploy admin API key, sent as `x-api-key` header (NOT `Authorization: Bearer`).

**How to get one**:
1. Log into your Dokploy dashboard
2. Profile → API Keys → Generate
3. Copy the value

**Validator**: length ≥ 24.

## Test

After both are set, run `node skills/sc-dokploy/scripts/projects.js list` — should print your project table.
