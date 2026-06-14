// lib/env.js — shared env-string parsing + ~/.bashrc / .env file helpers
const fs = require('fs');
const os = require('os');
const path = require('path');

// Wrap a value in single quotes for POSIX shells, neutralizing $, `, \, ".
// Closes the quote, emits an escaped literal ', reopens — the canonical idiom.
function shSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Strip one matching pair of surrounding quotes (symmetric with how
// appendExportToShellRc / KEY="value" writers emit values).
function stripWrappingQuotes(value = '') {
  const v = String(value);
  if (v.length >= 2) {
    const f = v[0], l = v[v.length - 1];
    if ((f === '"' && l === '"') || (f === "'" && l === "'")) return v.slice(1, -1);
  }
  return v;
}

function parseEnvString(envString = '') {
  const env = {};
  for (const rawLine of envString.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = stripWrappingQuotes(line.slice(eq + 1));
    if (key) env[key] = value;
  }
  return env;
}

function mergeEnvString(existingEnv = '', updates = {}) {
  const lines = existingEnv.split(/\r?\n/).filter(l => l.trim().length > 0);
  const env = parseEnvString(existingEnv);
  const order = [];
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key && !order.includes(key)) order.push(key);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    if (!order.includes(key)) order.push(key);
    env[key] = String(value);
  }
  return order.map(k => `${k}=${env[k]}`).join('\n');
}

function scanProcessEnv(keys = []) {
  const present = {};
  const missing = [];
  for (const k of keys) {
    if (process.env[k] && process.env[k].length > 0) present[k] = process.env[k];
    else missing.push(k);
  }
  return { present, missing };
}

function readShellRc(shellRcPath = path.join(os.homedir(), '.bashrc')) {
  if (!fs.existsSync(shellRcPath)) return '';
  return fs.readFileSync(shellRcPath, 'utf8');
}

const SI_CODER_BEGIN = '# --- si-coder onboarding ---';
const SI_CODER_END = '# --- end si-coder onboarding ---';

// Rewrite the managed si-coder block in place (dedupe keys, single-quote
// escape so $ / backtick are inert on `source`). Idempotent across runs.
function appendExportToShellRc(updates, shellRcPath = path.join(os.homedir(), '.bashrc')) {
  let content = fs.existsSync(shellRcPath) ? fs.readFileSync(shellRcPath, 'utf8') : '';

  // Collect export lines from any prior managed block(s) so keys written by an
  // earlier (separate) onboarding run survive an incremental run. Updates win.
  const prior = new Map(); // key -> verbatim `export KEY=...` line (already escaped)
  const scanRe = /# --- si-coder onboarding[^\n]*\n([\s\S]*?)# --- end si-coder onboarding ---/g;
  let m;
  while ((m = scanRe.exec(content)) !== null) {
    for (const rawLine of m[1].split(/\r?\n/)) {
      const mm = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=/.exec(rawLine.trim());
      if (mm) prior.set(mm[1], rawLine.trim());
    }
  }

  // Drop any prior managed block(s) — including old dated headers.
  content = content.replace(
    /\n?# --- si-coder onboarding[^\n]*\n[\s\S]*?# --- end si-coder onboarding ---\n?/g,
    '\n',
  );

  // Merge prior keys (original order preserved) with current `updates`
  // (Map.set keeps first-insertion order, so updated keys stay in place and
  // new keys append). Single-quote escaped so $ / backtick are inert on `source`.
  const merged = new Map(prior);
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined || v === null) continue;
    merged.set(k, `export ${k}=${shSingleQuote(v)}`);
  }

  const lines = [SI_CODER_BEGIN, ...merged.values(), SI_CODER_END];
  const trimmed = content.replace(/\n+$/, '');
  const next = `${trimmed}\n\n${lines.join('\n')}\n`;
  // This file holds exported secrets — honor the README's "0600 secret files" claim.
  // writeFileSync's mode only applies when CREATING the file (it won't downgrade an
  // existing 0644 .bashrc), so chmod explicitly afterward to force owner-only perms.
  fs.writeFileSync(shellRcPath, next, { mode: 0o600 });
  fs.chmodSync(shellRcPath, 0o600);
}

module.exports = {
  parseEnvString,
  mergeEnvString,
  scanProcessEnv,
  readShellRc,
  appendExportToShellRc,
  shSingleQuote,
  stripWrappingQuotes,
};
