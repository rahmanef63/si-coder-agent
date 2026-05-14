#!/usr/bin/env node
// project.js — STUB. Create a Supabase project, capture the one-shot DB password.
//
// TODO(impl):
// 1. POST https://api.supabase.com/v1/projects with { organization_id, name, region, db_pass, plan }.
// 2. Response includes ref + db.password.
// 3. Write SUPABASE_DB_PASSWORD_<ref> to ~/.bashrc via lib/env.js appendExportToShellRc()
//    (the password is shown ONCE; if lost, must rotate via the dashboard).
// 4. Poll GET /v1/projects/:ref until status === 'ACTIVE_HEALTHY'.
// 5. Output anon key + service_role key (DO NOT log service_role to user — redact).
console.error('sc-supabase/project.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
