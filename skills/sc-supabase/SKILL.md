---
name: sc-supabase
description: "(STUB / NOT IMPLEMENTED YET) Supabase backend as an alternative to self-hosted Convex. Create project, apply migrations from supabase/migrations, deploy Edge Functions, generate types. For projects where Postgres + Row-Level-Security is a better fit than Convex's reactive query model."
---

# /sc-supabase — Supabase (STUB)

> **Status:** boilerplate only.

## When to use

- Project needs Postgres (relational, complex joins, mature SQL tooling) more than Convex's reactive model.
- Project wants Supabase Auth's social providers without self-hosting JWKS.
- Project already has Supabase migrations.

## Scope when implemented

- Provision a new Supabase project via the Management API.
- Apply `supabase/migrations/*.sql` in order.
- Deploy Edge Functions from `supabase/functions/`.
- Generate TypeScript types: `supabase gen types typescript`.
- Write `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` to project `.env`.

## Env vars

| Var | Purpose |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal token, https://supabase.com/dashboard/account/tokens |
| `SUPABASE_ORG_ID` | Org to create projects under |

## Suggested file layout

```
sc-supabase/
├── SKILL.md
└── scripts/
    ├── project.js     # create + capture project ref + db password
    ├── migrate.js     # apply migrations
    ├── functions.js   # deploy edge functions
    └── types.js       # generate TS types
```

## Implementation notes

- API base: `https://api.supabase.com/v1`
- Auth: `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`
- Project creation returns a DB password ONCE — capture and write to `~/.bashrc` immediately as `SUPABASE_DB_PASSWORD_<projectref>`.
- For migrations, the `supabase` CLI may be required as a sub-process — wrap it in `lib/supabase.js` (TODO).
