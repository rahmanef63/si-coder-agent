#!/usr/bin/env node
// jwt-template.js — STUB. Create the 'convex' JWT template in a Clerk instance so Convex can verify.
//
// TODO(impl):
// 1. POST https://api.clerk.com/v1/jwt_templates with:
//    { name: 'convex', signing_algorithm: 'RS256', claims: { aud: 'convex', iss: '<clerk-issuer>' } }
// 2. Auth: 'Authorization: Bearer <CLERK_SECRET_KEY>'
// 3. Write convex/auth.config.ts in the cwd project:
//    export default { providers: [{ domain: process.env.NEXT_PUBLIC_CLERK_FRONTEND_API_URL!, applicationID: 'convex' }] };
// 4. Idempotency: if a template named 'convex' already exists (404/409), patch it instead.
console.error('sc-clerk/jwt-template.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
