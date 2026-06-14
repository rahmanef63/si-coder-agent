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
  if (!url) {
    console.error('Usage: check-cloud.js --url https://<name>.convex.cloud');
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

  const allOk = Object.values(results).every(r => r.ok);
  if (!allOk) {
    console.log('\nHints:');
    if (results.jwks && !results.jwks.ok) console.log('  • jwks not 200 → configure @convex-dev/auth keys on the Cloud deployment via dashboard or env');
    if (results.version && !results.version.ok) console.log('  • version not 200 → deployment unreachable; check the URL and that the deploy succeeded');
    process.exit(2);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
