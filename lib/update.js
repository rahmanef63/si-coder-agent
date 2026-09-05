// update.js — conservative self-update for a git checkout.
// Never resets, never stashes, never rebases: dirty/diverged/ahead checkouts are refused.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_REPO = path.resolve(__dirname, '..');
const RUNTIME_UNTRACKED = [/^\.agent\/evidence\/[^/]+\.json$/, /^\.agent\/memory\/tasks(?:\/|$)/];
function statusRows(repoDir) { return git(repoDir, ['status', '--porcelain=v1', '--untracked-files=all']).stdout.split(/\r?\n/).filter(Boolean); }
function runtimeArtifact(row) { if (!row.startsWith('?? ')) return false; const name=row.slice(3); return RUNTIME_UNTRACKED.some(re=>re.test(name)); }

function git(repoDir, args, { allowFailure = false } = {}) {
  const r = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFailure) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim());
  return { code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

function repoInfo(repoDir = DEFAULT_REPO) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return { gitCheckout: false, repoDir, reason: 'not a git checkout' };
  }
  const branch = git(repoDir, ['branch', '--show-current']).stdout;
  if (!branch) return { gitCheckout: true, repoDir, branch: null, reason: 'detached HEAD' };
  const head = git(repoDir, ['rev-parse', 'HEAD']).stdout;
  const rows = statusRows(repoDir);
  const ignoredRuntimeArtifacts = rows.filter(runtimeArtifact).map(row=>row.slice(3));
  const sourceChanges = rows.filter(row=>!runtimeArtifact(row));
  const dirty = sourceChanges.length > 0;
  return { gitCheckout: true, repoDir, branch, head, dirty, sourceChanges, ignoredRuntimeArtifacts };
}

function checkUpdate({ repoDir = DEFAULT_REPO, remote = 'origin', fetch = true } = {}) {
  const info = repoInfo(repoDir);
  if (!info.gitCheckout || !info.branch) return { ...info, updateable: false };
  const remoteRef = `${remote}/${info.branch}`;
  if (fetch) git(repoDir, ['fetch', '--quiet', remote, info.branch]);
  const exists = git(repoDir, ['rev-parse', '--verify', remoteRef], { allowFailure: true });
  if (exists.code !== 0) return { ...info, remote, remoteRef, updateable: false, reason: `${remoteRef} not found` };
  const remoteHead = exists.stdout;
  const counts = git(repoDir, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]).stdout.split(/\s+/).map(Number);
  const ahead = counts[0] || 0;
  const behind = counts[1] || 0;
  let state = 'up-to-date';
  if (ahead && behind) state = 'diverged';
  else if (ahead) state = 'ahead';
  else if (behind) state = 'behind';
  return {
    ...info, remote, remoteRef, remoteHead, ahead, behind, state,
    updateable: !info.dirty && ahead === 0,
  };
}

function performUpdate(options = {}) {
  const status = checkUpdate(options);
  if (!status.gitCheckout) throw new Error('sc update requires a git checkout; reinstall/upgrade the package with your package manager instead');
  if (!status.branch) throw new Error('sc update refuses detached HEAD');
  if (status.dirty) throw new Error(`sc update refuses source changes; commit/stash first: ${status.sourceChanges.slice(0, 5).map(x=>x.slice(3)).join(', ')}`);
  if (status.state === 'diverged') throw new Error(`sc update refuses diverged history (${status.ahead} ahead, ${status.behind} behind)`);
  if (status.state === 'ahead') throw new Error(`sc update refuses to rewrite ${status.ahead} local commit(s); push or reconcile them first`);
  if (status.state === 'up-to-date') return { ...status, changed: false };
  git(status.repoDir, ['merge', '--ff-only', status.remoteRef]);
  const after = repoInfo(status.repoDir);
  return { ...status, changed: true, newHead: after.head };
}

module.exports = { DEFAULT_REPO, git, repoInfo, checkUpdate, performUpdate, runtimeArtifact };
