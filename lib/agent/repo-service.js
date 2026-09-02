'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { scanSecretRisks } = require('./security');

function rootPath(root = process.cwd()) { return path.resolve(root); }

function run(command, args = [], options = {}) {
  const cwd = rootPath(options.root);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: options.env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
  });
  return {
    command,
    arguments: args.map(String),
    code: result.status === null ? 1 : result.status,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : null,
  };
}

function gitState(root = process.cwd()) {
  const head = run('git', ['rev-parse', '--verify', 'HEAD'], { root });
  if (head.code !== 0) return { git: false, head: null, dirty: null, branch: null, commitTime: null };
  const branch = run('git', ['branch', '--show-current'], { root });
  const status = run('git', ['status', '--porcelain'], { root });
  const time = run('git', ['show', '-s', '--format=%cI', 'HEAD'], { root });
  return {
    git: true,
    head: head.stdout.trim(),
    branch: branch.stdout.trim() || null,
    dirty: Boolean(status.stdout.trim()),
    commitTime: time.code === 0 && time.stdout.trim() ? time.stdout.trim() : null,
  };
}

function syntaxCheck(files, root = process.cwd()) {
  const rows = [];
  for (const file of files) {
    const result = run(process.execPath, ['--check', file], { root });
    rows.push({ file, code: result.code, ok: result.code === 0, stderr: result.stderr.trim() });
    if (result.code !== 0) break;
  }
  return { ok: rows.every(row => row.ok), rows };
}

function runRegression(root = process.cwd()) { return run('npm', ['test'], { root, maxBuffer: 32 * 1024 * 1024 }); }
function runDocsCheck(root = process.cwd()) { return run('npm', ['run', 'docs:check'], { root }); }

function walkFiles(dir, { skipDirs = new Set() } = {}) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walkFiles(full, { skipDirs }));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function scanFilesForSecrets(files, root = process.cwd()) {
  const base = rootPath(root);
  const findings = [];
  let textFilesScanned = 0;
  let binaryOrLargeSkipped = 0;
  for (const file of files) {
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (stat.size > 2 * 1024 * 1024) { binaryOrLargeSkipped++; continue; }
    const raw = fs.readFileSync(file);
    if (raw.includes(0)) { binaryOrLargeSkipped++; continue; }
    textFilesScanned++;
    const rel = path.relative(base, file);
    const risks = scanSecretRisks(raw.toString('utf8'), rel);
    findings.push(...risks.map(r => ({ file: rel, ...r })));
  }
  return { ok: findings.length === 0, filesScanned: files.length, textFilesScanned, binaryOrLargeSkipped, findings };
}

function scanAgentState(root = process.cwd()) {
  const base = path.join(rootPath(root), '.agent');
  return scanFilesForSecrets(walkFiles(base), root);
}

function scanRepositorySecrets(root = process.cwd()) {
  const base = rootPath(root);
  // Scan the whole checkout, including untracked files that could accidentally be copied
  // into generated archives/npm packages. Only VCS/dependency caches are skipped.
  const files = walkFiles(base, { skipDirs: new Set(['.git', 'node_modules', '__pycache__']) });
  return scanFilesForSecrets(files, root);
}

module.exports = { run, gitState, syntaxCheck, runRegression, runDocsCheck, walkFiles, scanAgentState, scanRepositorySecrets };
