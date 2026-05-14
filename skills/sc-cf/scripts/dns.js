#!/usr/bin/env node
// dns.js — STUB. Cloudflare DNS CRUD. Drop-in alternative to lib/hostinger.js.
//
// TODO(impl):
// 1. Add lib/cloudflare.js with makeClient({ apiToken, accountId }) → call() helper
//    that POSTs to https://api.cloudflare.com/client/v4/<endpoint>.
// 2. Cache zone ID by root domain (GET /zones?name=...).
// 3. CRUD against /zones/:zoneId/dns_records.
// 4. Export configureDns({ fullDomain, dokployApiUrl }) matching the
//    lib/hostinger.js signature so /sc-all can swap providers cleanly.
//
// CLI surface (planned):
//   node scripts/dns.js list   --zone <root.tld>
//   node scripts/dns.js create --zone <root.tld> --type A --name api-foo --content 1.2.3.4
//   node scripts/dns.js delete --record-id <id>
//
// Env required: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
console.error('sc-cf/dns.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
