// _shared.js — common helpers for sc-git scripts
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(os.homedir(), 'projects');

// Resolve the GitHub owner lazily: prefer $GH_OWNER, else derive it from the
// authed `gh` user so the tool targets YOUR account with zero config — and no
// maintainer username ships hardcoded in this public repo. Cached; only fires
// for subcommands that actually read OWNER (audit/status/runner/nuke/webhook),
// never for local-only ones (ci/hook).
let _owner = process.env.GH_OWNER || null;
function resolveOwner() {
  if (_owner) return _owner;
  try { _owner = gh(['api', 'user', '--jq', '.login']).trim(); } catch { /* handled below */ }
  if (!_owner) {
    err('GH_OWNER not set and could not resolve the authed gh user. Run `gh auth login` or set GH_OWNER=<your-github-username>.');
    process.exit(1);
  }
  return _owner;
}

// Flags whose value is free text and may legitimately start with '--'
// (e.g. `--description "--force was needed"`, `--cmd "node x --flag"`). For
// these we ALWAYS consume the next token, even if it begins with dashes — and
// `--key=value` is honored for any flag. Everything else keeps the old
// next-token-starts-with-`--`-means-boolean heuristic so genuine standalone
// flags (--force, --json, --quiet, ...) still work without a value.
const VALUE_FLAGS = new Set([
  'description', 'cmd', 'message', 'body', 'title', 'context', 'name',
  'schedule', 'state', 'sha', 'repo', 'url', 'label', 'level', 'out',
  'since', 'id', 'events', 'workflow', 'skip',
]);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { o[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n !== undefined && (VALUE_FLAGS.has(k) || !n.startsWith('--'))) {
        o[k] = n; i++;
      } else {
        o[k] = true;
      }
    } else {
      o._.push(a);
    }
  }
  return o;
}

function gh(args, { json = false, stdin = null } = {}) {
  const res = spawnSync('gh', args, {
    encoding: 'utf8',
    input: stdin || undefined,
    maxBuffer: 100 * 1024 * 1024,
    timeout: 30000, // kill a hung gh op instead of stalling forever
  });
  // spawnSync sets .error (ETIMEDOUT) and/or .signal (SIGTERM) when the timeout fires.
  if (res.error && res.error.code === 'ETIMEDOUT') {
    throw new Error(`gh ${args.join(' ')} timed out after 30s`);
  }
  if (res.error) throw res.error;
  if (res.signal) {
    throw new Error(`gh ${args.join(' ')} killed by signal ${res.signal} (likely 30s timeout)`);
  }
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} failed:\n${res.stderr || res.stdout}`);
  }
  return json ? JSON.parse(res.stdout) : res.stdout;
}

// body:    string fields via -f (always string)
// rawBody: typed fields via -F (true/false/number stay typed; "field[]=x" repeats for arrays)
// input:   send a full JSON object via --input - (stdin); used when raw typing must be exact
function ghApi(endpoint, { method = 'GET', body = null, rawBody = null, input = null, jq = null, paginate = false } = {}) {
  const args = ['api'];
  if (paginate) args.push('--paginate');
  if (method !== 'GET') args.push('-X', method);
  if (body) {
    for (const [k, v] of Object.entries(body)) {
      args.push('-f', `${k}=${v}`);
    }
  }
  if (rawBody) {
    for (const [k, v] of Object.entries(rawBody)) {
      // Arrays expand into repeated `key[]=item` raw fields (proper multi-value encoding).
      if (Array.isArray(v)) {
        for (const item of v) args.push('-F', `${k}[]=${item}`);
      } else {
        args.push('-F', `${k}=${v}`); // -F keeps booleans/numbers typed
      }
    }
  }
  let stdin = null;
  if (input) { args.push('--input', '-'); stdin = JSON.stringify(input); }
  if (jq) args.push('--jq', jq);
  args.push(endpoint);
  const out = gh(args, { stdin });
  if (jq) return out.trim();
  try { return JSON.parse(out); } catch { return out; }
}

function listRepos() {
  // `users/:owner/repos` returns PUBLIC repos only — it silently drops every
  // private repo (verified live: 0 private via that endpoint, 106 via this one),
  // so the default audit sweep would skip them. `user/repos` is the authed-user
  // endpoint and honors `affiliation=owner` to keep it to repos we own. Response
  // shape ({name,private,archived}) is identical, so audit.js callers are unchanged.
  return ghApi('user/repos?per_page=100&affiliation=owner', { paginate: true });
}

function repoExists(repo) {
  try { ghApi(`repos/${resolveOwner()}/${repo}`); return true; } catch { return false; }
}

function localRepoPath(repo) {
  const candidates = [
    path.join(PROJECTS_DIR, repo),
    path.join(PROJECTS_DIR, repo.toLowerCase()),
  ];
  for (const p of candidates) if (fs.existsSync(path.join(p, '.git'))) return p;
  return null;
}

function workflowFiles(repo) {
  const local = localRepoPath(repo);
  if (local) {
    const dir = path.join(local, '.github', 'workflows');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.(ya?ml)$/i.test(f) && !f.endsWith('.bak'))
      .map(f => ({ name: f, abs: path.join(dir, f), local: true }));
  }
  // remote-only
  try {
    const list = ghApi(`repos/${resolveOwner()}/${repo}/actions/workflows`).workflows || [];
    return list.map(w => ({ name: path.basename(w.path), abs: w.path, local: false, id: w.id, state: w.state }));
  } catch { return []; }
}

// ISO-8601 date or datetime — anything else is rejected before it touches the URL.
const ISO8601_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;

function runCount(repo, since) {
  // Validate + encode `since` (user-supplied via --since) so it can't smuggle
  // extra query params or characters into the API URL.
  if (!ISO8601_RE.test(since)) {
    throw new Error(`invalid --since value: ${JSON.stringify(since)} (expected ISO-8601 e.g. 2026-04-15)`);
  }
  const safeSince = encodeURIComponent(since);
  try {
    // Read total_count (not page-1 length, which clamps at per_page=100 and
    // understates burn on the hottest repos). per_page=1 keeps the payload tiny.
    // Encode the `>` operator (%3E) so the URL is canonical.
    const out = ghApi(`repos/${resolveOwner()}/${repo}/actions/runs?per_page=1&created=%3E${safeSince}`, { jq: '.total_count' });
    return parseInt(out, 10) || 0;
  } catch { return 0; }
}

// Shared trigger detection — single source of truth for "is this dispatch-only?".
// Consumed by BOTH audit.js and disable.js so the two halves of the skill never
// disagree. Handles every `on:` form: bare block `on:`, quoted `"on":`,
// single-line scalar `on: push`, and flow-seq `on: [push, pull_request]`.
function detectTriggers(yamlText) {
  const t = { push: false, pr: false, schedule: false, dispatch: false, workflowRun: false, paths: false, branches: [], cron: [] };
  // Strip YAML comments before matching so a commented-out trigger like `# push:`
  // or `on: push  # disabled` isn't misclassified as active. Full-line comments
  // become empty; a trailing ` #...` is dropped. (Good enough for trigger blocks;
  // `#` inside quoted scalars is rare in `on:` and not worth a full YAML parse.)
  const lines = (yamlText || '').split('\n').map(line => {
    const stripped = line.replace(/^\s*#.*$/, '').replace(/\s+#.*$/, '');
    return stripped;
  });
  let inOn = false, indent = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Start of an `on:` key in any form (bare block, flow-seq, single scalar, quoted).
    if (/^("on"|on):\s*$/.test(l) || /^("on"|on):\s*\[/.test(l) || /^"on":/.test(l) || /^on:\s*\S/.test(l)) {
      inOn = true;
      indent = l.search(/\S/);
      // Single-line/flow forms carry their triggers on this very line — scan it too.
    } else if (inOn) {
      const cur = l.search(/\S/);
      if (l.trim() && cur <= indent) inOn = false;
    }
    if (inOn || /^("on"|on):\s/.test(l)) {
      if (/(^|\s)push\s*:/.test(l) || /(^|[\s[,])push(?=[\s\],]|$)/.test(l)) t.push = true;
      if (/(^|\s)pull_request\s*:/.test(l) || /(^|[\s[,])pull_request(?=[\s\],]|$)/.test(l)) t.pr = true;
      if (/(^|\s)schedule\s*:/.test(l)) t.schedule = true;
      if (/(^|\s)workflow_dispatch\s*:/.test(l) || /(^|[\s[,])workflow_dispatch(?=[\s\],]|$)/.test(l)) t.dispatch = true;
      if (/(^|\s)workflow_run\s*:/.test(l)) t.workflowRun = true;
      if (/^\s+paths:/.test(l)) t.paths = true;
      const cron = l.match(/cron:\s*['"]([^'"]+)['"]/); if (cron) t.cron.push(cron[1]);
      const br = l.match(/branches:\s*\[([^\]]+)\]/); if (br) t.branches.push(...br[1].split(',').map(s => s.trim().replace(/['"]/g, '')));
    }
  }
  return t;
}

function backup(filePath) {
  const bak = filePath + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak);
  return bak;
}

function gitInRepo(repoPath, args) {
  const res = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8', timeout: 30000 });
  // spawnSync sets .error (ETIMEDOUT) and/or .signal (SIGTERM) when the timeout fires.
  if (res.error && res.error.code === 'ETIMEDOUT') {
    throw new Error(`git ${args.join(' ')} timed out after 30s`);
  }
  if (res.error) throw res.error;
  if (res.signal) {
    throw new Error(`git ${args.join(' ')} killed by signal ${res.signal} (likely 30s timeout)`);
  }
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function ensureBranch(repoPath, branch) {
  try {
    gitInRepo(repoPath, ['rev-parse', '--verify', branch]);
    gitInRepo(repoPath, ['checkout', branch]);
  } catch {
    gitInRepo(repoPath, ['checkout', '-b', branch]);
  }
}

function log(...a) { console.log(...a); }
function warn(...a) { console.warn('⚠️ ', ...a); }
function err(...a) { console.error('❌', ...a); }
function ok(...a) { console.log('✅', ...a); }

module.exports = {
  PROJECTS_DIR,
  parseArgs, gh, ghApi,
  listRepos, repoExists, localRepoPath, workflowFiles, runCount, detectTriggers,
  backup, gitInRepo, ensureBranch,
  log, warn, err, ok,
};
// OWNER is a lazy getter so consumers keep `const { OWNER } = require('./_shared')`
// unchanged — destructuring resolves it once, on demand, per subcommand.
Object.defineProperty(module.exports, 'OWNER', { enumerable: true, get: resolveOwner });
