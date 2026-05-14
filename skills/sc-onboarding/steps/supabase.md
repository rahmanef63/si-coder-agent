# Supabase credentials (STUB — for future /sc-supabase)

## `SUPABASE_ACCESS_TOKEN` (optional)

Personal access token for the Management API.

**How to get one**: https://supabase.com/dashboard/account/tokens → Generate new token.

**Validator**: starts with `sbp_`.

## `SUPABASE_ORG_ID` (optional)

Organisation under which `/sc-supabase` will create projects. Find it in `https://supabase.com/dashboard/org/<slug>/general` → Organization ID.

**Validator**: length ≥ 16.

## Note

Project creation returns the DB password **once**. `/sc-supabase` must capture it and write `SUPABASE_DB_PASSWORD_<projectref>` to `~/.bashrc` immediately — if lost, you'll need to rotate via the dashboard.
