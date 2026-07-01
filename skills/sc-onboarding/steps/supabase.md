# Supabase credentials (STUB — for future /sc-supabase)

## `SUPABASE_ACCESS_TOKEN` (optional)

Personal access token (PAT) for the Management API. A PAT has **full account access** (no granular scopes) — keep it secret.

**How to get one**: https://supabase.com/dashboard/account/tokens → "Generate new token" → name it → copy the `sbp_…` value (shown once).

**Validator**: starts with `sbp_`.

## `SUPABASE_ORG_ID` (optional)

Organisation under which `/sc-supabase` will create projects. This is the org **slug** (the Management API field is named `organization_id` but expects the slug, **not** the UUID).

**How to get it**: copy `<slug>` from your dashboard URL `https://supabase.com/dashboard/org/<slug>` — also labelled "Organization slug" under org General settings, or run `supabase orgs list`.

**Validator**: length ≥ 16.

## Note

Project creation returns the DB password **once**. `/sc-supabase` must capture it and write `SUPABASE_DB_PASSWORD_<projectref>` to `~/.bashrc` immediately — if lost, you'll need to rotate via the dashboard.
