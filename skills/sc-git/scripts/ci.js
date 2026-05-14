#!/usr/bin/env node
// ci.js — run local CI equivalent of repo workflow
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, localRepoPath, log, ok, err, warn } = require('./_shared');

const STEPS = ['typecheck', 'lint', 'test', 'build'];

function detectPM(cwd) {
  if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(cwd, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function pkgScripts(cwd) {
  const p = path.join(cwd, 'package.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')).scripts || {}; } catch { return {}; }
}

function run(cwd, pm, script, quiet) {
  log(`\n▶ ${pm} run ${script}`);
  const res = spawnSync(pm, ['run', script], {
    cwd,
    stdio: quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    if (quiet) console.error(res.stdout, res.stderr);
    return false;
  }
  ok(`${script} passed`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.repo ? localRepoPath(args.repo) : process.cwd();
  if (!cwd) { err(`repo not found locally: ${args.repo}`); process.exit(1); }
  const skip = (args.skip || '').split(',').map(s => s.trim()).filter(Boolean);
  const pm = detectPM(cwd);
  const scripts = pkgScripts(cwd);
  const quiet = !!args.quiet;

  log(`# sc-git ci`);
  log(`repo: ${path.basename(cwd)}`);
  log(`pm: ${pm}`);
  log(`scripts available: ${Object.keys(scripts).join(', ') || '(none)'}`);

  const order = STEPS.filter(s => !skip.includes(s) && scripts[s]);
  if (order.length === 0) {
    warn('no matching scripts (typecheck/lint/test/build). nothing to run.');
    return;
  }

  for (const s of order) {
    const okStep = run(cwd, pm, s, quiet);
    if (!okStep) { err(`step '${s}' failed`); process.exit(1); }
  }
  ok('all CI steps passed');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
