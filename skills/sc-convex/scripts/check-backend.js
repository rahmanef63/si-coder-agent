#!/usr/bin/env node
// check-backend.js — Probe Convex api-/site-/dash- subdomains + admin-key validity.
const path = require('path');
const { probeBackend } = require(path.resolve(__dirname, '../../../lib/convex'));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    }
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { domain } = args;
  const adminKey = args['admin-key'] || process.env.CONVEX_ADMIN_KEY;
  if (!domain) { console.error('Usage: check-backend.js --domain <root.tld> [--admin-key KEY]'); process.exit(1); }

  const apiDomain = `api-${domain}`;
  const siteDomain = `site-${domain}`;
  const dashDomain = `dash-${domain}`;

  console.log(`🔎 probing backend for ${domain}\n`);
  const results = await probeBackend({ apiDomain, siteDomain, dashDomain, adminKey });

  const rows = [];
  for (const [label, r] of Object.entries(results)) {
    const status = r.error ? `ERR: ${r.error}` : `${r.status} ${r.ok ? '✅' : '❌'}`;
    rows.push({ label, url: r.url, status });
  }
  console.table(rows);

  const allOk = Object.values(results).every(r => r.ok);
  if (!allOk) {
    console.log('\nHints:');
    if (results.api_jwks && !results.api_jwks.ok) console.log('  • api JWKS not 200 → set JWT_PRIVATE_KEY + JWKS via scripts/set-auth-env.js');
    if (results.api_admin && !results.api_admin.ok) console.log('  • admin-key rejected → rotate via scripts/rotate-admin-key.js');
    process.exit(2);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
