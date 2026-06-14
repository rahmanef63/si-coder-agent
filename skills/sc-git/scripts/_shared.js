// _shared.js — common helpers for sc-git scripts
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const OWNER = process.env.GH_OWNER || 'rahmanef63';
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(os.homedir(), 'projects');

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
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
  });
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
  return ghApi(`users/${OWNER}/repos?per_page=100&type=owner`, { paginate: true });
}

function repoExists(repo) {
  try { ghApi(`repos/${OWNER}/${repo}`); return true; } catch { return false; }
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
    const list = ghApi(`repos/${OWNER}/${repo}/actions/workflows`).workflows || [];
    return list.map(w => ({ name: path.basename(w.path), abs: w.path, local: false, id: w.id, state: w.state }));
  } catch { return []; }
}

function runCount(repo, since) {
  try {
    const out = ghApi(`repos/${OWNER}/${repo}/actions/runs?per_page=100&created=>${since}`, { jq: '.workflow_runs | length' });
    return parseInt(out, 10) || 0;
  } catch { return 0; }
}

function backup(filePath) {
  const bak = filePath + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(filePath, bak);
  return bak;
}

function gitInRepo(repoPath, args) {
  const res = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
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
  OWNER, PROJECTS_DIR,
  parseArgs, gh, ghApi,
  listRepos, repoExists, localRepoPath, workflowFiles, runCount,
  backup, gitInRepo, ensureBranch,
  log, warn, err, ok,
};
