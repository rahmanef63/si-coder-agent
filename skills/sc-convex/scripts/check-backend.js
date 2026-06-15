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
  const expectAuth = !!args['expect-auth'];
  // typeof check rejects a bare `--domain` flag (parseArgs yields `true`), so
  // the `api-/site-/dash-${domain}` hosts can't become `api-true` etc.
  if (typeof domain !== 'string') { console.error('Usage: check-backend.js --domain <root.tld> [--admin-key KEY] [--expect-auth]'); process.exit(1); }

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

  // Liveness gate: api_version is mandatory, and api_admin when an admin key
  // was supplied. JWKS is auth-specific advisory — a backend deployed WITHOUT
  // @convex-dev/auth legitimately has no JWKS, so it only gates when the caller
  // opts in with --expect-auth. site/dash rows are advisory only.
  const critical = ['api_version'];
  if (adminKey) critical.push('api_admin');
  if (expectAuth) critical.push('api_jwks');

  const allOk = critical.every(label => results[label] && results[label].ok);

  if (!expectAuth && results.api_jwks && !results.api_jwks.ok) {
    console.log('\nℹ️ api JWKS not 200 — auth not configured (informational; pass --expect-auth to require it)');
  }

  if (!allOk) {
    console.log('\nHints:');
    if (expectAuth && results.api_jwks && !results.api_jwks.ok) console.log('  • api JWKS not 200 → set JWT_PRIVATE_KEY + JWKS via scripts/set-auth-env.js');
    if (results.api_admin && !results.api_admin.ok) console.log('  • admin-key rejected → rotate via scripts/rotate-admin-key.js');
    if (results.api_version && !results.api_version.ok) console.log('  • api /version not 200 → backend not live; check compose deploy / restart policy');
    process.exit(2);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
