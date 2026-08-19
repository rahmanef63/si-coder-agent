#!/usr/bin/env node
// bin/onboard.js — Interactive CLI wizard for users who don't go through an AI.
// For each missing var it prints WHERE to get the value (the dashboard URL or a
// local command), then reads it — secrets are read WITHOUT echoing to the terminal,
// and no value is ever passed via argv (so nothing leaks to ps / shell history).
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const { appendExportToShellRc, scanProcessEnv } = require(path.resolve(__dirname, '../lib/env'));
const {
  DOMAIN_VARS, VALIDATORS, isSecret, sourceLine, readShellRcEnv,
} = require(path.resolve(__dirname, '../skills/sc-onboarding/lib/onboarding-domains'));

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

// One-line blurb per domain; falls back to the required/optional summary so a
// newly-registered DOMAIN_VARS entry always shows up in the menu (no drift).
const DOMAIN_BLURBS = {
  github: 'always required for deploy',
  dokploy: 'Dokploy CRUD + deploy',
  convex: 'Convex self-hosted',
  hostinger: 'DNS automation, optional',
  cf: 'Cloudflare DNS',
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
  cf: 'node skills/sc-cf/scripts/dns.js zones                    # verify Cloudflare token',
  hostinger: '# Hostinger token ready — used automatically for DNS records',
  sync: 'node skills/sc-sync/scripts/sync.js <vps-local|local-vps>  # dry-run first',
};

// Control-character codes, named — the raw-mode reader compares char codes so the
// source stays free of literal control bytes (which mangle on save/patch).
const CR = 13, LF = 10, EOT = 4, ETX = 3, BS = 8, DEL = 127, SPACE = 32;

// A plain, single-shot line read (visible echo). One interface per call so it can
// coexist with the raw-mode hidden reader below without them fighting over stdin.
function askVisible(promptText) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// A hidden line read: the prompt shows, keystrokes do not. Used for every secret
// so a shoulder-surfer or a scrollback log never captures the token. Falls back to
// a visible read when stdin is not a TTY (piped input can't enter raw mode) — the
// value still never touches argv, which is the leak that actually matters.
function askHidden(promptText) {
  const input = process.stdin;
  const output = process.stdout;
  if (!input.isTTY) return askVisible(promptText);
  return new Promise(resolve => {
    output.write(promptText);
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.resume();
    let buf = '';
    const onData = (d) => {
      for (const ch of d.toString('utf8')) {
        const code = ch.charCodeAt(0);
        if (code === CR || code === LF || code === EOT) {   // Enter / Ctrl-D
          input.removeListener('data', onData);
          input.setRawMode(wasRaw || false);
          input.pause();
          output.write('\n');
          return resolve(buf.trim());
        }
        if (code === ETX) { output.write('\n'); process.exit(130); } // Ctrl-C
        else if (code === BS || code === DEL) buf = buf.slice(0, -1); // Backspace
        else if (code >= SPACE) buf += ch;                            // ignore other control chars
      }
    };
    input.on('data', onData);
  });
}

function readStepDoc(domain) {
  const p = path.resolve(__dirname, '../skills/sc-onboarding/steps', `${domain}.md`);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  return null;
}

async function askDomainsInteractive() {
  console.log('\nWhich domains to set up? (comma-separated)\n');
  const names = Object.keys(DOMAIN_VARS);
  names.forEach((name, i) => {
    const blurb = DOMAIN_BLURBS[name] || `required: ${DOMAIN_VARS[name].required.join(', ') || '—'}`;
    console.log(`  [${i + 1}] ${name.padEnd(13)} (${blurb})`);
  });
  console.log('');
  const ans = await askVisible('Pick (e.g. "github,dokploy,convex"): ');
  const picked = ans.split(',').map(s => s.trim()).filter(Boolean);
  return picked.length === 0 ? ['github', 'dokploy'] : picked;
}

// Reveal at most ~25% of a value (cap 4 chars) so short secrets aren't echoed whole.
function redactValue(val) {
  if (!val) return '';
  const n = Math.min(4, Math.floor(val.length / 4));
  return `${val.slice(0, n)}…[len=${val.length}]`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n🚀 si-coder onboarding wizard\n');
  const domains = typeof args.domains === 'string'
    ? args.domains.split(',').map(s => s.trim())
    : await askDomainsInteractive();

  const allKeys = [];
  for (const d of domains) {
    if (!DOMAIN_VARS[d]) { console.log(`⚠️ unknown domain "${d}", skip`); continue; }
    for (const k of DOMAIN_VARS[d].required) allKeys.push({ key: k, required: true, domain: d });
    for (const k of DOMAIN_VARS[d].optional) allKeys.push({ key: k, required: false, domain: d });
  }

  // What is already present? (process.env wins over ~/.bashrc)
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
      if (doc) console.log(doc.split('\n').slice(0, 6).join('\n') + `\n  …(full doc: steps/${domain}.md)`);
      lastDomain = domain;
    }
    // The whole point of the wizard: tell the user WHERE to get this value.
    const src = sourceLine(key);
    console.log('');
    console.log(`  ${key}${required ? '' : '  (optional — press Enter to skip)'}`);
    if (src) console.log(`    ↳ ${src}`);
    if (isSecret(key)) console.log('    ↳ input is hidden (not echoed)');

    while (true) {
      const value = isSecret(key)
        ? await askHidden('    value: ')
        : await askVisible('    value: ');
      if (!value && !required) break;
      if (!value && required) { console.log(`    ❌ ${key} is required`); continue; }
      const validator = VALIDATORS[key];
      if (validator && !validator(value)) { console.log(`    ❌ ${key} failed validation, try again`); continue; }
      updates[key] = value;
      console.log(`    ✅ got ${key} (${redactValue(value)})`);
      break;
    }
  }

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
