#!/usr/bin/env node
// hook.js — install pre-push hook that runs local CI
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, localRepoPath, gitInRepo, log, ok, err, warn } = require('./_shared');

const SCRIPT_PATH = path.resolve(__dirname, 'ci.js');
const HOOK_BODY = `#!/usr/bin/env bash
# sc-git pre-push: run local CI before push
set -e
node "${SCRIPT_PATH}" || {
  echo ""
  echo "❌ sc-git ci failed. push blocked."
  echo "   override (NOT recommended): git push --no-verify"
  exit 1
}
`;

function install(repoPath) {
  // Prefer native .git/hooks (no husky dep required)
  const hooksDir = path.join(repoPath, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) { err('.git/hooks not found'); process.exit(1); }
  const target = path.join(hooksDir, 'pre-push');
  if (fs.existsSync(target)) {
    const cur = fs.readFileSync(target, 'utf8');
    if (cur.includes('sc-git pre-push')) {
      warn('sc-git pre-push already installed (idempotent).');
      return;
    }
    fs.copyFileSync(target, target + '.bak');
    warn('existing pre-push backed up to pre-push.bak');
  }
  fs.writeFileSync(target, HOOK_BODY, { mode: 0o755 });
  ok(`installed ${target}`);
}

function uninstall(repoPath) {
  const target = path.join(repoPath, '.git', 'hooks', 'pre-push');
  if (!fs.existsSync(target)) { warn('no pre-push installed'); return; }
  const content = fs.readFileSync(target, 'utf8');
  if (!content.includes('sc-git pre-push')) { warn('pre-push exists but not sc-git managed; refused.'); return; }
  fs.unlinkSync(target);
  const bak = target + '.bak';
  if (fs.existsSync(bak)) { fs.renameSync(bak, target); ok('restored previous pre-push from .bak'); }
  else ok('removed sc-git pre-push');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const repo = args.repo;
  if (!repo || !['install', 'uninstall'].includes(cmd)) {
    err('Usage: hook.js install|uninstall --repo <name>');
    process.exit(1);
  }
  const repoPath = localRepoPath(repo);
  if (!repoPath) { err(`local clone not found: ~/projects/${repo}`); process.exit(1); }
  if (cmd === 'install') install(repoPath);
  else uninstall(repoPath);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
