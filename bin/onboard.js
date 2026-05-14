#!/usr/bin/env node
// bin/onboard.js — One-shot CLI wizard for users who don't go through an AI.
// Reads steps/<domain>.md for context, prompts via readline, appends to ~/.bashrc.
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { appendExportToShellRc, scanProcessEnv, readShellRc, parseEnvString } = require(path.resolve(__dirname, '../lib/env'));

const DOMAIN_VARS = {
  github:    { required: ['GITHUB_TOKEN'], optional: [] },
  dokploy:   { required: ['DOKPLOY_API_URL', 'DOKPLOY_API_KEY'], optional: [] },
  convex:    { required: [], optional: ['CONVEX_ADMIN_KEY'] },
  hostinger: { required: [], optional: ['HOSTINGER_API_TOKEN'] },
  // STUB domains — scripts not implemented yet, but vars pre-registered.
  cf:        { required: [], optional: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] },
  stripe:    { required: [], optional: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  resend:    { required: [], optional: ['RESEND_API_KEY', 'RESEND_FROM_DOMAIN'] },
  clerk:     { required: [], optional: ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_FRONTEND_API_URL'] },
  vercel:    { required: [], optional: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'] },
  supabase:  { required: [], optional: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_ORG_ID'] },
};

const VALIDATORS = {
  GITHUB_TOKEN: v => (v.startsWith('ghp_') || v.startsWith('github_pat_')) && v.length >= 40,
  DOKPLOY_API_URL: v => v.startsWith('https://'),
  DOKPLOY_API_KEY: v => v.length >= 24,
  HOSTINGER_API_TOKEN: v => v.length >= 32,
  CONVEX_ADMIN_KEY: v => v.includes('|') && v.length >= 32,
  CLOUDFLARE_API_TOKEN: v => v.length >= 32,
  CLOUDFLARE_ACCOUNT_ID: v => v.length >= 16,
  STRIPE_SECRET_KEY: v => /^sk_(test|live)_/.test(v),
  STRIPE_PUBLISHABLE_KEY: v => /^pk_(test|live)_/.test(v),
  STRIPE_WEBHOOK_SECRET: v => v.startsWith('whsec_'),
  RESEND_API_KEY: v => v.startsWith('re_'),
  RESEND_FROM_DOMAIN: v => /\./.test(v),
  CLERK_SECRET_KEY: v => /^sk_(test|live)_/.test(v),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: v => /^pk_(test|live)_/.test(v),
  NEXT_PUBLIC_CLERK_FRONTEND_API_URL: v => v.startsWith('https://'),
  VERCEL_TOKEN: v => v.length >= 24,
  VERCEL_TEAM_ID: v => v.length >= 8,
  SUPABASE_ACCESS_TOKEN: v => v.startsWith('sbp_'),
  SUPABASE_ORG_ID: v => v.length >= 16,
};

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

function readStepDoc(domain) {
  const p = path.resolve(__dirname, '../skills/sc-onboarding/steps', `${domain}.md`);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return null;
}

function askDomainsInteractive(rl) {
  return new Promise(resolve => {
    console.log('\nWhich domains to set up? (comma-separated)\n');
    console.log('  [1] github     (always required for deploy)');
    console.log('  [2] dokploy    (Dokploy CRUD + deploy)');
    console.log('  [3] convex     (Convex self-hosted)');
    console.log('  [4] hostinger  (DNS automation, optional)');
    console.log('  [5] cf         (Cloudflare, future)\n');
    rl.question('Pick (e.g. "github,dokploy,convex"): ', (ans) => {
      const picked = ans.split(',').map(s => s.trim()).filter(Boolean);
      resolve(picked.length === 0 ? ['github', 'dokploy'] : picked);
    });
  });
}

function promptValue(rl, key) {
  return new Promise(resolve => {
    rl.question(`  ${key} = `, val => resolve(val.trim()));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🚀 si-coder onboarding wizard\n');
  const domains = args.domains
    ? args.domains.split(',').map(s => s.trim())
    : await askDomainsInteractive(rl);

  const allKeys = [];
  for (const d of domains) {
    if (!DOMAIN_VARS[d]) { console.log(`⚠️ unknown domain "${d}", skip`); continue; }
    for (const k of DOMAIN_VARS[d].required) allKeys.push({ key: k, required: true, domain: d });
    for (const k of DOMAIN_VARS[d].optional) allKeys.push({ key: k, required: false, domain: d });
  }

  // What is already present?
  const fromProc = scanProcessEnv(allKeys.map(x => x.key)).present;
  const rcEnv = parseEnvString(readShellRc().replace(/^\s*export\s+/gm, ''));

  const updates = {};
  let lastDomain = null;
  for (const { key, required, domain } of allKeys) {
    if (fromProc[key] || rcEnv[key]) {
      console.log(`  ✅ ${key} already set (${(fromProc[key] || rcEnv[key]).slice(0, 12)}…), skipping`);
      continue;
    }
    if (domain !== lastDomain) {
      const doc = readStepDoc(domain);
      console.log(`\n── ${domain.toUpperCase()} ──`);
      if (doc) console.log(doc.split('\n').slice(0, 8).join('\n') + '\n  …(see steps/' + domain + '.md for full doc)\n');
      lastDomain = domain;
    }
    while (true) {
      const value = await promptValue(rl, `${key}${required ? '' : ' (optional, leave blank to skip)'}`);
      if (!value && !required) break;
      if (!value && required) { console.log(`  ❌ ${key} is required`); continue; }
      const validator = VALIDATORS[key];
      if (validator && !validator(value)) { console.log(`  ❌ ${key} failed validation, try again`); continue; }
      updates[key] = value;
      break;
    }
  }

  rl.close();

  if (Object.keys(updates).length === 0) {
    console.log('\n✅ Nothing to write — all required vars already set.');
    return;
  }

  appendExportToShellRc(updates);
  console.log(`\n✅ Wrote ${Object.keys(updates).length} export(s) to ~/.bashrc`);
  console.log('\nNext:');
  console.log('  source ~/.bashrc');
  console.log('  node skills/sc-dokploy/scripts/projects.js list   # verify Dokploy auth');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
