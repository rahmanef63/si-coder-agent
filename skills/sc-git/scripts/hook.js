#!/usr/bin/env node
// hook.js — install pre-push hook that runs local CI
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { parseArgs, localRepoPath, gitInRepo, log, ok, err, warn } = require('./_shared');

const SCRIPT_PATH = path.resolve(__dirname, 'ci.js');
// Hook body has TWO independent guards:
//   1. local CI (typecheck/lint/test) — always runs.
//   2. self-hosted Convex auto-deploy — runs ONLY when the repo carries a
//      convex/ dir + .env.local exposes CONVEX_SELF_HOSTED_URL +
//      CONVEX_SELF_HOSTED_ADMIN_KEY, and only when the pending commits
//      touch convex/. Backend leads frontend so the Dokploy rebuild that
//      follows this push never lands ahead of the Convex schema.
// If the repo lacks self-hosted Convex (no convex/ dir, or no env keys),
// guard 2 is a silent no-op — the hook is safe to install in any repo.
const HOOK_BODY = `#!/usr/bin/env bash
# sc-git pre-push: local CI + self-hosted Convex auto-deploy
set -e

# Guard 1 — local CI
node "${SCRIPT_PATH}" --skip build || {
  echo ""
  echo "❌ sc-git ci failed. push blocked."
  echo "   override (NOT recommended): git push --no-verify"
  exit 1
}

# Guard 2 — self-hosted Convex auto-deploy (silent no-op if not configured)
if [ -d convex ] && [ -f .env.local ] \\
   && grep -q "^CONVEX_SELF_HOSTED_URL=" .env.local 2>/dev/null \\
   && grep -q "^CONVEX_SELF_HOSTED_ADMIN_KEY=" .env.local 2>/dev/null; then
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || true)
  REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "")
  if [ -n "$REMOTE_SHA" ] && [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    CONVEX_DIFF=$(git diff --name-only "$REMOTE_SHA"..HEAD -- convex/ 2>/dev/null || true)
    if [ -n "$CONVEX_DIFF" ]; then
      echo ""
      echo "▶ sc-git: convex/ changed → auto-deploy self-hosted Convex FIRST"
      # Convex CLI v1.27+ auto-detects self-hosted from env. No flags needed.
      set -a; . ./.env.local; set +a
      pnpm exec convex deploy --yes || {
        echo ""
        echo "❌ Convex self-hosted deploy failed. push aborted."
        echo "   Fix Convex deploy first; do NOT --no-verify (frontend would land ahead of backend)."
        exit 1
      }
      echo "✓ Convex deploy complete. Continuing push."
    fi
  fi
fi
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
