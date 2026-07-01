#!/usr/bin/env node
// scan-env.js — Detect which required env vars are set per domain. Used by both AI mode and CLI mode.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { scanProcessEnv, appendExportToShellRc } = require(path.resolve(__dirname, '../../../lib/env'));
const { DOMAIN_VARS, VALIDATORS, readShellRcEnv } = require(path.resolve(__dirname, '../lib/onboarding-domains'));

// Read the keys currently present inside the managed si-coder block of ~/.bashrc.
// Used to report the ACTUAL number of exports written, since appendExportToShellRc
// silently skips keys that are invalid identifiers or already exported (unmanaged)
// outside the block — the pre-write count of `updates` would overstate those.
function managedBlockKeys(shellRcPath = path.join(os.homedir(), '.bashrc')) {
  const keys = new Set();
  let content = '';
  try { content = fs.readFileSync(shellRcPath, 'utf8'); } catch { return keys; }
  const re = /# --- si-coder onboarding[^\n]*\n([\s\S]*?)# --- end si-coder onboarding ---/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    for (const rawLine of m[1].split(/\r?\n/)) {
      const mm = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=/.exec(rawLine.trim());
      if (mm) keys.add(mm[1]);
    }
  }
  return keys;
}

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
  // Snapshot the managed block before/after so we report the ACTUAL number of
  // exports that landed, not the pre-write count of `updates` (which overstates
  // when appendExportToShellRc skips invalid or already-unmanaged keys).
  const before = managedBlockKeys();
  appendExportToShellRc(updates);
  const after = managedBlockKeys();

  const requested = Object.keys(updates);
  // A requested key counts as written if it's now in the managed block AND it
  // was either newly added or its line changed (re-runs may leave a key present
  // but unchanged). We can't compare values cheaply, so report newly-present +
  // requested keys that survived, and surface skips explicitly.
  const written = requested.filter(k => after.has(k));
  const skipped = requested.filter(k => !after.has(k));
  const added = [...after].filter(k => !before.has(k)).length;

  if (written.length === requested.length) {
    console.log(`✅ wrote ${written.length} export(s) to ~/.bashrc (${added} new this run)`);
  } else {
    console.log(`✅ wrote ${written.length}/${requested.length} requested export(s) to ~/.bashrc (${added} new this run)`);
    console.log(`   skipped (invalid key or already exported outside the block): ${skipped.join(', ')}`);
  }
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
  const raw = typeof args.domains === 'string' ? args.domains : 'github,dokploy,convex,hostinger';
  const domains = raw.split(',').map(s => s.trim()).filter(Boolean);
  // collectKeys() silently skips domains not in DOMAIN_VARS; surface typos to
  // STDERR (keeps --json stdout clean) so a mistyped --domains isn't a silent no-op.
  for (const d of domains) {
    if (!DOMAIN_VARS[d]) console.error(`⚠️ unknown domain "${d}", skip`);
  }

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
