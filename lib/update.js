// update.js — conservative self-update for a git checkout.
// Fast-forward only. Dirty local work is preserved automatically with a temporary local stash,
// restored after the update, and never discarded when restoration conflicts.
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
    // Dirty work is updateable because performUpdate() now preserves and reapplies it.
    updateable: ahead === 0,
    preservesLocalChanges: true,
  };
}

function refreshCliLink(repoDir) {
  const r = spawnSync('npm', ['link'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) return { ok: false, reason: r.error.message };
  if (r.status !== 0) return { ok: false, reason: (r.stderr || r.stdout || 'npm link failed').trim().slice(0, 500) };
  return { ok: true };
}

function preserveLocalChanges(repoDir) {
  const before = statusRows(repoDir);
  if (!before.length) return null;
  const marker = `sc-update-auto-preserve-${Date.now()}`;
  const pushed = git(repoDir, [
    '-c', 'user.name=SI-Coder Update',
    '-c', 'user.email=update@si-coder.local',
    'stash', 'push', '--include-untracked', '-m', marker,
  ], { allowFailure: true });
  if (pushed.code !== 0) {
    throw new Error(`sc update could not preserve local changes safely: ${(pushed.stderr || pushed.stdout || 'git stash failed').slice(0, 500)}`);
  }
  if (/No local changes to save/i.test(pushed.stdout)) return null;
  const stashSha = git(repoDir, ['rev-parse', 'stash@{0}'], { allowFailure: true });
  if (stashSha.code !== 0 || !stashSha.stdout) {
    throw new Error('sc update preserved local changes but could not verify the temporary stash; update stopped before changing source');
  }
  return { marker, ref: 'stash@{0}', sha: stashSha.stdout };
}

function restoreLocalChanges(repoDir, preserved) {
  if (!preserved) return { restored: true, preserved: false };
  const current = git(repoDir, ['rev-parse', preserved.ref], { allowFailure: true });
  if (current.code !== 0 || current.stdout !== preserved.sha) {
    return {
      restored: false,
      preserved: true,
      stash: preserved.ref,
      reason: 'temporary stash moved; local work remains preserved in the stash list',
    };
  }
  const applied = git(repoDir, ['stash', 'pop', '--index', preserved.ref], { allowFailure: true });
  if (applied.code !== 0) {
    return {
      restored: false,
      preserved: true,
      stash: preserved.ref,
      reason: (applied.stderr || applied.stdout || 'local changes need reconciliation').slice(0, 1000),
    };
  }
  return { restored: true, preserved: true, stashDropped: true };
}

function performUpdate(options = {}) {
  const status = checkUpdate(options);
  if (!status.gitCheckout) throw new Error('sc update requires a git checkout; reinstall/upgrade the package with your package manager instead');
  if (!status.branch) throw new Error('sc update refuses detached HEAD');
  if (status.state === 'diverged') throw new Error(`sc update refuses diverged history (${status.ahead} ahead, ${status.behind} behind)`);
  if (status.state === 'ahead') throw new Error(`sc update refuses to rewrite ${status.ahead} local commit(s); push or reconcile them first`);

  // Nothing needs changing. Keep the working tree exactly as-is and only heal the CLI link.
  if (status.state === 'up-to-date') {
    return { ...status, changed: false, localChangesPreserved: status.dirty, cliLink: refreshCliLink(status.repoDir) };
  }

  let preserved = null;
  if (status.dirty) preserved = preserveLocalChanges(status.repoDir);

  try {
    git(status.repoDir, ['merge', '--ff-only', status.remoteRef]);
  } catch (err) {
    const restore = restoreLocalChanges(status.repoDir, preserved);
    if (!restore.restored) {
      throw new Error(`sc update stopped before completion and local changes remain preserved in ${restore.stash || 'git stash'}: ${restore.reason}`);
    }
    throw err;
  }

  const after = repoInfo(status.repoDir);
  const restore = restoreLocalChanges(status.repoDir, preserved);
  if (!restore.restored) {
    throw new Error(
      `sc updated to ${after.head}, but local changes need reconciliation. ` +
      `They are still preserved in ${restore.stash || 'git stash'}; SC did not discard them. ${restore.reason}`
    );
  }

  return {
    ...status,
    changed: true,
    newHead: after.head,
    localChangesPreserved: Boolean(preserved),
    localChangesRestored: Boolean(preserved),
    cliLink: refreshCliLink(status.repoDir),
  };
}

module.exports = {
  DEFAULT_REPO,
  git,
  repoInfo,
  checkUpdate,
  performUpdate,
  refreshCliLink,
  preserveLocalChanges,
  restoreLocalChanges,
  runtimeArtifact,
};
