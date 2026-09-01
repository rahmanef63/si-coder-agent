# Composio project API credentials

## `COMPOSIO_API_KEY`

**Get it:** sign in to https://composio.dev → **Platform** → choose the project → **Settings** → **API Keys** → create/copy a project API key.

Use a project key (`ak_*`) for `COMPOSIO_API_KEY`. Prefer the narrowest scoped project key that still covers the tools/actions your agent needs. Consumer/Connect keys (`ck_*`) are a different credential and are intentionally rejected here.

**Verify:**

```bash
sc doctor --providers composio
```

The doctor performs a read-only `GET /api/v3.1/tools?limit=1` with the key in the `x-api-key` header. The secret is never printed.
