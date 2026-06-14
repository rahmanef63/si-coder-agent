#!/usr/bin/env node
// scan-env.js — Detect which required env vars are set per domain. Used by both AI mode and CLI mode.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scanProcessEnv, readShellRc, appendExportToShellRc, parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

const DOMAIN_VARS = {
  github:    { required: ['GITHUB_TOKEN'], optional: [] },
  dokploy:   { required: ['DOKPLOY_API_URL', 'DOKPLOY_API_KEY'], optional: [] },
  convex:    { required: [], optional: ['CONVEX_ADMIN_KEY'] },
  hostinger: { required: [], optional: ['HOSTINGER_API_TOKEN'] },
  // STUB domains — vars pre-registered so /sc-onboarding can collect them.
  // Scripts for these /sc-* skills are not implemented yet (exit code 2).
  cf:        { required: [], optional: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] },
  stripe:    { required: [], optional: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  resend:    { required: [], optional: ['RESEND_API_KEY', 'RESEND_FROM_DOMAIN'] },
  clerk:     { required: [], optional: ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_FRONTEND_API_URL'] },
  vercel:        { required: ['VERCEL_TOKEN'], optional: ['VERCEL_TEAM_ID'] },
  'convex-cloud':{ required: ['CONVEX_DEPLOY_KEY'], optional: ['CONVEX_DEPLOYMENT'] },
  supabase:  { required: [], optional: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_ORG_ID'] },
};

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    } else { o._.push(a); }
  }
  return o;
}

function collectKeys(domains) {
  const required = new Set();
  const optional = new Set();
  for (const d of domains) {
    if (!DOMAIN_VARS[d]) continue;
    for (const k of DOMAIN_VARS[d].required) required.add(k);
    for (const k of DOMAIN_VARS[d].optional) optional.add(k);
  }
  return { required: [...required], optional: [...optional] };
}

function redact(val) {
  if (!val) return '';
  return `${val.slice(0, 12)}…[len=${val.length}]`;
}

function reportEnv({ domains }) {
  const { required, optional } = collectKeys(domains);
  const all = [...required, ...optional];
  const fromProcess = scanProcessEnv(all);
  const rcEnv = parseEnvString(readShellRc().replace(/^\s*export\s+/gm, '')) ;

  const rows = all.map(k => {
    const value = fromProcess.present[k] || rcEnv[k] || '';
    const source = fromProcess.present[k] ? 'process.env' : (rcEnv[k] ? '~/.bashrc' : '—');
    const status = value ? '✅' : (required.includes(k) ? '❌ MISSING' : '⚠️ optional');
    return { key: k, required: required.includes(k), status, source, preview: redact(value) };
  });

  return {
    rows,
    missingRequired: required.filter(k => !fromProcess.present[k] && !rcEnv[k]),
    missingOptional: optional.filter(k => !fromProcess.present[k] && !rcEnv[k]),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const domains = (args.domains || 'github,dokploy,convex,hostinger').split(',').map(s => s.trim()).filter(Boolean);

  if (args.write) {
    // Read --set KEY=VALUE multi-arg from positional/list
    const setPairs = args._.filter(s => s.includes('='));
    const updates = {};
    for (const p of setPairs) {
      const eq = p.indexOf('=');
      updates[p.slice(0, eq)] = p.slice(eq + 1);
    }
    if (Object.keys(updates).length === 0) {
      console.error('Usage: scan-env.js --write KEY=VALUE [KEY=VALUE...]');
      process.exit(1);
    }
    appendExportToShellRc(updates);
    console.log(`✅ appended ${Object.keys(updates).length} export(s) to ~/.bashrc`);
    console.log('   run: source ~/.bashrc');
    return;
  }

  const report = reportEnv({ domains });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n🔎 Scan for domains: ${domains.join(', ')}\n`);
  console.table(report.rows);

  if (report.missingRequired.length > 0) {
    console.log('\n❌ Missing REQUIRED:');
    for (const k of report.missingRequired) console.log(`  • ${k}`);
  }
  if (report.missingOptional.length > 0) {
    console.log('\n⚠️ Missing OPTIONAL:');
    for (const k of report.missingOptional) console.log(`  • ${k}`);
  }
  if (report.missingRequired.length === 0 && report.missingOptional.length === 0) {
    console.log('\n✅ all required + optional vars present');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
