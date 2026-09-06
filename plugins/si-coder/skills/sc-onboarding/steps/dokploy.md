# Dokploy credentials

## `DOKPLOY_API_URL` (required)

The base URL of your Dokploy admin API. Always ends with `/api` — the scripts auto-append it if missing.

Examples:
- `https://backend.example.com/api`
- `https://dokploy.mydomain.com/api`

**Validator**: starts with `https://`.

## `DOKPLOY_API_KEY` (required)

The Dokploy admin API key, sent as `x-api-key` header (NOT `Authorization: Bearer`).

**Get it** (self-hosted — created inside your own panel): `<your Dokploy panel>/dashboard/settings/profile` → **API/CLI** section → Generate → copy the token.

**Permissions**: log in as an admin (admins generate directly; non-admins need permission granted first). The token inherits your account's access — an admin token = full API.

**Validator**: length ≥ 24.

## Test

After both are set, run `node skills/sc-dokploy/scripts/projects.js list` — should print your project table.
