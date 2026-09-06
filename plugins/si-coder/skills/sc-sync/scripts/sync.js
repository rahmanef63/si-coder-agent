#!/usr/bin/env node
// sync.js — rsync gitignored files between a VPS and a local machine over
// Tailscale, for a repo that's checked out (mirrored path) on both. Direction
// is resolved from SYNC_ROLE crossed with the requested direction via
// route() in _shared.js — never by sniffing `hostname` (leak/fragility risk).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run } = require(path.resolve(__dirname, '../../../lib/proc'));
const { parseArgs, route, filterBlocked, log, warn, err, ok } = require('./_shared');

function usage() {
  log('Usage: node skills/sc-sync/scripts/sync.js <vps-local|local-vps> [--apply] [path...]');
  log('');
  log('  vps-local   VPS -> local machine');
  log('  local-vps   local machine -> VPS');
  log('  --apply     actually copy (default is a dry-run preview)');
  log('  [path...]   explicit repo-relative paths to sync instead of the');
  log('              default (git-ignored files reported by');
  log('              `git ls-files --others --ignored --exclude-standard`)');
  log('');
  log('Env: SYNC_ROLE (vps|local), SYNC_VPS_TS_ADDR, SYNC_LOCAL_TS_ADDR,');
  log('     SYNC_REMOTE_USER (optional), SYNC_REMOTE_PATH (optional)');
}

function repoRoot(cwd) {
  return run('git', ['rev-parse', '--show-toplevel'], { cwd }).trim();
}

// Default file set: everything git reports as untracked-but-ignored for this
// repo, minus noise dirs (node_modules, build output, VCS internals, ...).
// Read once, locally — deliberately not SSH'd into the remote side; both
// checkouts share the same .gitignore so the same rule set applies.
function defaultFileList(root) {
  const out = run('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], { cwd: root });
  const files = out.split('\0').filter(Boolean);
  return filterBlocked(files);
}

function buildRemoteSpec({ user, addr, remotePath }) {
  const p = remotePath.endsWith('/') ? remotePath : `${remotePath}/`;
  return `${user}@${addr}:${p}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const direction = args._[0];
  const explicitPaths = args._.slice(1);
  const apply = !!args.apply;

  if (!direction || args.help) {
    usage();
    process.exit(direction ? 0 : 1);
  }

  const role = process.env.SYNC_ROLE;
  const vpsAddr = process.env.SYNC_VPS_TS_ADDR;
  const localAddr = process.env.SYNC_LOCAL_TS_ADDR;
  const remoteUser = process.env.SYNC_REMOTE_USER || os.userInfo().username;

  if (role !== 'vps' && role !== 'local') {
    err(`SYNC_ROLE must be exactly "vps" or "local" (got: ${JSON.stringify(role)})`);
    process.exit(1);
  }
  if (!vpsAddr) { err('SYNC_VPS_TS_ADDR is required (tailscale MagicDNS alias or 100.x IP of the VPS)'); process.exit(1); }
  if (!localAddr) { err('SYNC_LOCAL_TS_ADDR is required (tailscale MagicDNS alias or 100.x IP of the local machine)'); process.exit(1); }

  let route_;
  try {
    route_ = route(direction, role);
  } catch (e) {
    err(e.message);
    usage();
    process.exit(1);
  }
  const { mode, other } = route_;

  const root = repoRoot(process.cwd());
  const remotePath = process.env.SYNC_REMOTE_PATH || root;
  const addrByRole = { vps: vpsAddr, local: localAddr };
  const remoteAddr = addrByRole[other];

  const localSpec = root.endsWith('/') ? root : `${root}/`;
  const remoteSpec = buildRemoteSpec({ user: remoteUser, addr: remoteAddr, remotePath });

  const srcSpec = mode === 'push' ? localSpec : remoteSpec;
  const dstSpec = mode === 'push' ? remoteSpec : localSpec;

  const files = explicitPaths.length ? explicitPaths : defaultFileList(root);
  if (files.length === 0) {
    warn('nothing to sync (no gitignored files found and no explicit paths given)');
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `sc-sync-${crypto.randomBytes(6).toString('hex')}.txt`);
  fs.writeFileSync(tmpFile, files.join('\n') + '\n', 'utf8');

  const rsyncArgs = ['-avzu'];
  if (!apply) rsyncArgs.push('--dry-run');
  rsyncArgs.push(`--files-from=${tmpFile}`, srcSpec, dstSpec);

  log(`# sc-sync ${direction} (role=${role}, mode=${mode})`);
  log(`src: ${srcSpec}`);
  log(`dst: ${dstSpec}`);
  log(`files: ${files.length}`);
  log(apply ? 'mode: APPLY (copying for real)' : 'mode: DRY RUN (pass --apply to actually copy)');

  // NOTE: process.exit() inside a catch would skip this finally (Node quirk —
  // exit() terminates before the stack unwinds further), leaking the tmp
  // file on every failure. Set a flag instead and exit after the try/finally
  // has fully run.
  let failed = false;
  try {
    run('rsync', rsyncArgs, { stdio: 'inherit' });
  } catch (e) {
    err(`rsync failed: ${e.message}`);
    failed = true;
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
  if (failed) process.exit(1);

  ok(apply ? 'sync applied' : 'dry-run complete — re-run with --apply to copy');
}

main();
