#!/usr/bin/env node
// bin/onboard.js — One-shot CLI wizard for users who don't go through an AI.
// Reads steps/<domain>.md for context, prompts via readline, appends to ~/.bashrc.
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { appendExportToShellRc, scanProcessEnv } = require(path.resolve(__dirname, '../lib/env'));
const { DOMAIN_VARS, VALIDATORS, readShellRcEnv } = require(path.resolve(__dirname, '../skills/sc-onboarding/lib/onboarding-domains'));

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

// One-line blurb per domain; falls back to the required/optional summary so a
// newly-registered DOMAIN_VARS entry always shows up in the menu (no drift).
const DOMAIN_BLURBS = {
  github: 'always required for deploy',
  dokploy: 'Dokploy CRUD + deploy',
  convex: 'Convex self-hosted',
  hostinger: 'DNS automation, optional',
  cf: 'Cloudflare, future',
  stripe: 'Stripe payments (stub)',
  resend: 'Resend email (stub)',
  clerk: 'Clerk auth (stub)',
  vercel: 'Vercel online frontend',
  'convex-cloud': 'Convex Cloud backend',
  supabase: 'Supabase backend (stub)',
  sync: 'Tailscale rsync vps<->local',
};

// Per-domain "you're set — verify with this" next step, shown only for picked domains.
const VERIFY_HINTS = {
  github: '/sc-git status                                            # (or: gh api user) verify GitHub auth',
  dokploy: 'node skills/sc-dokploy/scripts/projects.js list          # verify Dokploy auth',
  convex: '/sc-convex                                                # deploy a self-hosted Convex backend',
  'convex-cloud': 'node skills/sc-convex-cloud/scripts/check-cloud.js  # verify Convex Cloud deploy key',
  vercel: '/sc-vercel                                                # deploy the online frontend',
  hostinger: '# Hostinger token ready — used automatically for DNS records',
  sync: 'node skills/sc-sync/scripts/sync.js <vps-local|local-vps>  # dry-run first',
};

function askDomainsInteractive(rl) {
  return new Promise(resolve => {
    console.log('\nWhich domains to set up? (comma-separated)\n');
    const names = Object.keys(DOMAIN_VARS);
    names.forEach((name, i) => {
      const blurb = DOMAIN_BLURBS[name]
        || `required: ${DOMAIN_VARS[name].required.join(', ') || '—'}`;
      console.log(`  [${i + 1}] ${name.padEnd(13)} (${blurb})`);
    });
    console.log('');
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

// Reveal at most ~25% of a value (cap 4 chars) so short secrets aren't echoed whole.
function redactValue(val) {
  if (!val) return '';
  const n = Math.min(4, Math.floor(val.length / 4));
  return `${val.slice(0, n)}…`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🚀 si-coder onboarding wizard\n');
  const domains = typeof args.domains === 'string'
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
  const rcEnv = readShellRcEnv();

  const updates = {};
  let lastDomain = null;
  for (const { key, required, domain } of allKeys) {
    if (fromProc[key] || rcEnv[key]) {
      console.log(`  ✅ ${key} already set (${redactValue(fromProc[key] || rcEnv[key])}), skipping`);
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
  const hints = domains.filter(d => VERIFY_HINTS[d]);
  if (hints.length) for (const d of hints) console.log('  ' + VERIFY_HINTS[d]);
  else console.log('  # done — run the /sc-* skill for the domain you configured');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
