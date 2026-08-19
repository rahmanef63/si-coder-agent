// profiles.js — more than one identity on one machine, and a folder→identity map.
//
// The problem this solves is concrete and was expensive: two VPSes owned by two different
// people, each with its own Cloudflare/Dokploy/Hostinger credentials, and a single
// ~/.bashrc that can only hold one set. One stale `export` in the wrong shell is all it
// takes to write DNS into someone else's zone.
//
// So credentials move out of ~/.bashrc into per-profile files, and `sc.md` — plain markdown,
// meant to be edited by hand — records which directory belongs to which profile.
//
// PRECEDENCE, and why: when a profile resolves for the current directory, its values BEAT
// process.env. That is the opposite of the usual "the shell wins" instinct, and it is
// deliberate. The two failure modes are not symmetric: a profile losing to a stale shell
// export means silently deploying with the wrong account's credentials, while a profile
// winning means an intentional one-off override is ignored — annoying, and `--no-profile`
// undoes it. Safe-by-default beats convenient-by-default when the blast radius is someone
// else's infrastructure.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEnvString, shSingleQuote } = require(path.resolve(__dirname, 'env'));
// providers.js does not require this file, so there is no cycle.
const { PROVIDERS } = require(path.resolve(__dirname, 'providers'));

/** Every credential key the registry knows about — the set a profile is allowed to own. */
const REGISTRY_KEYS = PROVIDERS.flatMap(p => p.vars).map(v => v.key);

const CONFIG_DIR = process.env.SC_CONFIG_DIR || path.join(os.homedir(), '.config', 'si-coder');
const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');
const SC_MD = path.join(CONFIG_DIR, 'sc.md');

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function ensureDirs() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(CONFIG_DIR, 0o700); fs.chmodSync(PROFILES_DIR, 0o700); } catch { /* best effort */ }
}

function assertName(name) {
  // The name becomes a filename. Anything with a slash or a dot-dot would escape the
  // profiles directory, so reject it rather than sanitising and guessing the intent.
  if (!NAME_RE.test(String(name || ''))) {
    throw new Error(`invalid profile name ${JSON.stringify(name)} — use letters, digits, . _ -`);
  }
  return name;
}

const profilePath = (name) => path.join(PROFILES_DIR, `${assertName(name)}.env`);

function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR)
    .filter(f => f.endsWith('.env'))
    .map(f => f.slice(0, -4))
    .sort();
}

function profileExists(name) { return fs.existsSync(profilePath(name)); }

function readProfile(name) {
  const p = profilePath(name);
  if (!fs.existsSync(p)) return {};
  const env = parseEnvString(fs.readFileSync(p, 'utf8'));
  for (const k of Object.keys(env)) env[k] = env[k].replace(/'\\''/g, "'");
  return env;
}

/** Merge `updates` into a profile. Values are shell-quoted so `sc env` output is safe to eval. */
function writeProfile(name, updates) {
  ensureDirs();
  const merged = { ...readProfile(name), ...updates };
  for (const k of Object.keys(merged)) if (merged[k] === undefined || merged[k] === null) delete merged[k];
  const body = Object.entries(merged).map(([k, v]) => `${k}=${shSingleQuote(v)}`).join('\n');
  const p = profilePath(name);
  fs.writeFileSync(p, `${body}\n`, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  return merged;
}

function removeFromProfile(name, keys) {
  const cur = readProfile(name);
  const removed = keys.filter(k => k in cur);
  for (const k of removed) delete cur[k];
  ensureDirs();
  const body = Object.entries(cur).map(([k, v]) => `${k}=${shSingleQuote(v)}`).join('\n');
  fs.writeFileSync(profilePath(name), `${body}\n`, { mode: 0o600 });
  fs.chmodSync(profilePath(name), 0o600);
  return removed;
}

function deleteProfile(name) {
  const p = profilePath(name);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

// ---------------------------------------------------------------------------
// sc.md — the human-editable map
// ---------------------------------------------------------------------------
const SC_MD_TEMPLATE = `# sc.md — si-coder profiles

This file is read by \`sc\`. Edit it by hand or use \`sc user\` — both write the same shapes.

## Active profile

Active profile: \`__ACTIVE__\`

Used when the current directory matches no row below.

## Folder → profile

The **longest matching path wins**, so a specific subdirectory can override its parent.
Paths may start with \`~\`. A row whose profile does not exist is reported by \`sc user which\`.

| Path | Profile |
| --- | --- |
__ROWS__

## Notes

Credentials live in \`~/.config/si-coder/profiles/<name>.env\` (mode 0600), never in this file.
When a profile is active its values **override** the shell environment — see \`sc user which\`.
Bypass it for one command with \`--no-profile\`.
`;

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseScMd(file = SC_MD) {
  if (!fs.existsSync(file)) return { active: null, mappings: [], exists: false };
  const text = fs.readFileSync(file, 'utf8');
  const active = (/Active profile:\s*`([^`]+)`/.exec(text) || [])[1] || null;
  const mappings = [];
  for (const line of text.split(/\r?\n/)) {
    // | path | profile |  — skip the header and the --- separator row.
    const m = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/.exec(line);
    if (!m) continue;
    const [, rawPath, rawProfile] = m;
    if (/^-+$/.test(rawPath.trim()) || rawPath.trim().toLowerCase() === 'path') continue;
    const p = rawPath.replace(/^`|`$/g, '').trim();
    const prof = rawProfile.replace(/^`|`$/g, '').trim();
    if (!p || !prof) continue;
    mappings.push({ path: p, resolved: path.resolve(expandHome(p)), profile: prof });
  }
  // "(none)" is what writeScMd renders for an empty slot; reading it back as a profile name
  // made "is anything active?" answer yes forever, so the first profile never became active.
  const EMPTY = new Set(['__ACTIVE__', '(none)', 'none', '']);
  return { active: active && !EMPTY.has(active) ? active : null, mappings, exists: true };
}

function writeScMd(state, file = SC_MD) {
  ensureDirs();
  const rows = state.mappings.length
    ? state.mappings.map(m => `| \`${m.path}\` | \`${m.profile}\` |`).join('\n')
    : '| _(none yet — `sc user map <path> <profile>`)_ | |';
  const body = SC_MD_TEMPLATE
    .replace('__ACTIVE__', state.active || '(none)')
    .replace('__ROWS__', rows);
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * Which profile governs `cwd`, and why.
 * Longest matching path wins; a directory only matches itself or its descendants, so
 * /a/bcd never matches a rule for /a/bc.
 */
function resolveProfile(cwd = process.cwd(), file = SC_MD) {
  const state = parseScMd(file);
  let best = null;
  for (const m of state.mappings) {
    const base = m.resolved;
    const hit = cwd === base || cwd.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
    if (hit && (!best || base.length > best.resolved.length)) best = m;
  }
  if (best) return { profile: best.profile, reason: `sc.md maps ${best.path}`, mapping: best, state };
  if (state.active) return { profile: state.active, reason: 'sc.md active profile', mapping: null, state };
  return { profile: null, reason: 'no profile configured', mapping: null, state };
}

/**
 * The environment sc-* code should run with.
 *
 * Profile values override process.env, AND — the part that actually delivers isolation —
 * every registry credential the profile does NOT define is REMOVED. Merging would leave the
 * other identity's leftovers from ~/.bashrc visible: stand in a folder mapped to `beta`,
 * with `alpha`'s DOKPLOY_API_KEY still exported from a login shell, and a deploy would
 * happily use it. Only registry keys are dropped; PATH, HOME and everything else survive.
 *
 * `shadowed` lists what was removed, so callers can say so out loud instead of leaving the
 * user wondering why a variable they can see in `env` is not being used.
 */
function loadEnvFor(cwd = process.cwd(), { noProfile = false, shellRcEnv = {} } = {}) {
  const base = { ...shellRcEnv };
  for (const [k, v] of Object.entries(process.env)) if (v) base[k] = v;
  if (noProfile) return { env: base, profile: null, reason: '--no-profile', shadowed: [], own: {} };
  const { profile, reason } = resolveProfile(cwd);
  if (!profile || !profileExists(profile)) {
    return {
      env: base, profile: null, shadowed: [], own: {},
      reason: profile ? `profile "${profile}" not found` : reason,
    };
  }
  const own = readProfile(profile);
  const env = { ...base };
  const shadowed = [];
  for (const k of REGISTRY_KEYS) {
    if (own[k] !== undefined) env[k] = own[k];
    else if (env[k] !== undefined) { delete env[k]; shadowed.push(k); }
  }
  return { env, profile, reason, shadowed, own };
}

module.exports = {
  REGISTRY_KEYS,
  CONFIG_DIR, PROFILES_DIR, SC_MD, SC_MD_TEMPLATE,
  ensureDirs, listProfiles, profileExists, profilePath,
  readProfile, writeProfile, removeFromProfile, deleteProfile,
  parseScMd, writeScMd, resolveProfile, loadEnvFor, expandHome, assertName,
};
