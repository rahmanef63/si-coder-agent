#!/usr/bin/env node
// scan-env.js — Detect which required env vars are set per domain. Used by both AI mode and CLI mode.
const path = require('path');
const { scanProcessEnv, appendExportToShellRc } = require(path.resolve(__dirname, '../../../lib/env'));
const { DOMAIN_VARS, VALIDATORS, readShellRcEnv } = require(path.resolve(__dirname, '../lib/onboarding-domains'));

// Boolean flags never consume the following token, so positional KEY=VALUE
// pairs after `--write` are parsed as pairs, not swallowed as the flag's value.
const BOOL_FLAGS = new Set(['write', 'write-stdin', 'json']);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (BOOL_FLAGS.has(k)) { o[k] = true; continue; }
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

// Read all of stdin to a string. Used by --write-stdin so secrets never appear
// in argv (and thus never in `ps aux` / /proc/<pid>/cmdline / shell history).
function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

// Parse newline- and/or argv-style KEY=VALUE pairs into an ordered map.
function parsePairs(items) {
  const updates = {};
  for (const p of items) {
    if (!p.includes('=')) continue;
    const eq = p.indexOf('=');
    updates[p.slice(0, eq)] = p.slice(eq + 1);
  }
  return updates;
}

// Validate each pair against VALIDATORS (shared source of truth with the CLI
// wizard) before writing, so a mis-collected credential fails loudly here
// instead of silently surfacing later in sc-git / sc-dokploy. Returns the list
// of keys that failed; unknown keys (no validator) pass through.
function validatePairs(updates) {
  const failed = [];
  for (const [key, value] of Object.entries(updates)) {
    const validator = VALIDATORS[key];
    if (validator && !validator(value)) failed.push(key);
  }
  return failed;
}

// Validate then append to ~/.bashrc. On any validation failure, prints which
// keys failed and exits 1 WITHOUT writing anything (all-or-nothing).
function writeUpdates(updates) {
  if (Object.keys(updates).length === 0) {
    console.error('Usage: scan-env.js --write KEY=VALUE [KEY=VALUE...]  (or pipe pairs via --write-stdin)');
    process.exit(1);
  }
  const failed = validatePairs(updates);
  if (failed.length > 0) {
    for (const k of failed) console.error(`${k} failed validation`);
    process.exit(1);
  }
  appendExportToShellRc(updates);
  console.log(`✅ appended ${Object.keys(updates).length} export(s) to ~/.bashrc`);
  console.log('   run: source ~/.bashrc');
}

function redact(val) {
  if (!val) return '';
  // Reveal at most ~25% of the value (cap 4 chars) so short secrets
  // (VERCEL_TEAM_ID, CONVEX_DEPLOYMENT, RESEND_FROM_DOMAIN) aren't printed whole.
  const n = Math.min(4, Math.floor(val.length / 4));
  return `${val.slice(0, n)}…[len=${val.length}]`;
}

function reportEnv({ domains }) {
  const { required, optional } = collectKeys(domains);
  const all = [...required, ...optional];
  const fromProcess = scanProcessEnv(all);
  const rcEnv = readShellRcEnv();

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

  if (args['write-stdin']) {
    // Preferred secret path: read newline-delimited KEY=VALUE pairs from stdin
    // so values never appear in argv (ps aux / /proc/<pid>/cmdline / history).
    const raw = await readStdin();
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
    writeUpdates(parsePairs(lines));
    return;
  }

  if (args.write) {
    // argv path: KEY=VALUE pairs are positional and may appear before OR after
    // `--write` (it is a boolean flag and never swallows the next token).
    // NOTE: argv is world-readable — prefer --write-stdin for secrets.
    writeUpdates(parsePairs(args._));
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
