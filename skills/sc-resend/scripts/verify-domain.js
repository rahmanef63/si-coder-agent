#!/usr/bin/env node
// verify-domain.js — STUB. Register sending domain with Resend + auto-write DKIM/SPF/DMARC DNS records.
//
// TODO(impl):
// 1. POST https://api.resend.com/domains with { name: <RESEND_FROM_DOMAIN> }.
// 2. Response includes records: [{ name, type, value }]. For each, call:
//    - sc-cf/dns.js createRecord(...) if CLOUDFLARE_API_TOKEN set, else
//    - lib/hostinger.js zone PUT.
// 3. Poll GET /domains/:id until status === 'verified' (or timeout).
// 4. Print final status table.
console.error('sc-resend/verify-domain.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
