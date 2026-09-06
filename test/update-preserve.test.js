const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { performUpdate } = require('../lib/update');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-update-preserve-')); }
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `git ${args.join(' ')} failed`);
  return (r.stdout || '').trim();
}

test('SCUPDATE-1: conflicting dirty work remains recoverable in stash after fast-forward', () => {
  const dir = tmp();
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  const local = path.join(dir, 'local');
  fs.mkdirSync(seed, { recursive: true });
  git(dir, ['init', '--bare', remote]);
  git(seed, ['init']);
  git(seed, ['config', 'user.email', 'test@example.com']);
  git(seed, ['config', 'user.name', 'SC Test']);
  fs.writeFileSync(path.join(seed, 'file.txt'), 'base\n');
  git(seed, ['add', 'file.txt']); git(seed, ['commit', '-m', 'base']); git(seed, ['branch', '-M', 'main']);
  git(seed, ['remote', 'add', 'origin', remote]); git(seed, ['push', '-u', 'origin', 'main']);
  git(dir, ['clone', '-b', 'main', remote, local]);

  fs.writeFileSync(path.join(seed, 'file.txt'), 'remote\n');
  git(seed, ['add', 'file.txt']); git(seed, ['commit', '-m', 'remote']); git(seed, ['push']);
  fs.writeFileSync(path.join(local, 'file.txt'), 'local\n');

  assert.throws(() => performUpdate({ repoDir: local }), /local changes need reconciliation/);
  assert.strictEqual(git(local, ['rev-parse', 'HEAD']), git(seed, ['rev-parse', 'HEAD']), 'remote fast-forward must still be installed');
  const stashList = git(local, ['stash', 'list']);
  assert.match(stashList, /sc-update-auto-preserve-/);
  const patch = git(local, ['stash', 'show', '-p', 'stash@{0}']);
  assert.match(patch, /\+local/);
  fs.rmSync(dir, { recursive: true, force: true });
});
