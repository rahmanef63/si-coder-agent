#!/usr/bin/env node
// check-cloud.js — Probe a Convex Cloud deployment's /version + /.well-known/jwks.json.
const path = require('path');
const { probeCloud, deriveCloudUrl } = require(path.resolve(__dirname, '../../../lib/convex-cloud'));

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
  const url = args.url || deriveCloudUrl(process.env.CONVEX_DEPLOY_KEY);
  const expectAuth = !!args['expect-auth'];
  if (!url) {
    console.error('Usage: check-cloud.js --url https://<name>.convex.cloud [--expect-auth]');
    console.error('  (or set CONVEX_DEPLOY_KEY to a prod: key to derive the URL)');
    process.exit(1);
  }

  console.log(`🔎 probing Convex Cloud deployment ${url}\n`);
  const results = await probeCloud({ deploymentUrl: url });

  const rows = [];
  for (const [label, r] of Object.entries(results)) {
    const status = r.error ? `ERR: ${r.error}` : `${r.status} ${r.ok ? '✅' : '❌'}`;
    rows.push({ label, url: r.url, status });
  }
  console.table(rows);

  // Liveness gate: /version is mandatory. JWKS is auth-specific and lives on the
  // *.convex.site host — a deployment WITHOUT @convex-dev/auth legitimately has no
  // JWKS, so it only gates the exit code when the caller opts in with --expect-auth.
  // (A custom domain has no derivable site host, so jwks is simply absent = not-checked.)
  const critical = ['version'];
  if (expectAuth) critical.push('jwks');

  const allOk = critical.every(label => results[label] && results[label].ok);

  if (!expectAuth && results.jwks && !results.jwks.ok) {
    console.log('\nℹ️ JWKS not 200 — auth not configured (informational; pass --expect-auth to require it)');
  }

  if (!allOk) {
    console.log('\nHints:');
    if (expectAuth && results.jwks && !results.jwks.ok) console.log('  • jwks not 200 → configure @convex-dev/auth keys on the Cloud deployment (JWKS is served on the *.convex.site host)');
    if (results.version && !results.version.ok) console.log('  • version not 200 → deployment unreachable; check the URL and that the deploy succeeded');
    process.exit(2);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
