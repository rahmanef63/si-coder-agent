#!/usr/bin/env node
// convex-deploy.js — pre-push guard. When the pending push touches convex/, deploy Convex
// (cloud OR self-hosted) FIRST so the host rebuild that follows never lands the frontend ahead of
// the backend (the skew that silently breaks prod). Silent no-op when the repo has no Convex or the
// push doesn't touch it. Exits non-zero ONLY on a real deploy failure → aborts the push.
//
// Fully dynamic — nothing hardcoded:
//   • convex dir : first of [CONVEX_DIR env] | '.' | 'web' | 'app' | 'apps/web' that has ./convex,
//                  preferring one whose .env.local actually yields a deploy mode (dual-dir repos).
//   • mode       : self-hosted if .env.local has CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY,
//                  else cloud if any of CONVEX_DEPLOY_KEY | CONVEX_DEPLOYMENT | NEXT_PUBLIC_CONVEX_URL is set.
//   • target     : `convex deploy` always targets the project's PRODUCTION deployment.
//   • runner     : `pnpm exec` when pnpm-lock.yaml is present, else `npx`.
// Flags: --dry-run (resolve + print the plan, deploy nothing) · --self-test (assert the pure logic).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const C = { red: '\x1b[31m', grn: '\x1b[32m', ylw: '\x1b[33m', dim: '\x1b[2m', rst: '\x1b[0m' };
const say = (m) => process.stderr.write(m + '\n');

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd: cwd || process.cwd(), encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

// Ref to diff HEAD against: upstream of HEAD, else origin/<branch>, else origin/main|master.
// null = no resolvable base (fresh remote / first push) → caller deploys fail-safe rather than skip.
function diffBase(repo) {
  const up = (git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repo) || '').trim();
  if (up && git(['rev-parse', '--verify', up], repo)) return up;
  const br = (git(['rev-parse', '--abbrev-ref', 'HEAD'], repo) || '').trim();
  for (const ref of [br && `origin/${br}`, 'origin/main', 'origin/master'].filter(Boolean)) {
    if (git(['rev-parse', '--verify', ref], repo)) return ref;
  }
  return null;
}

// Minimal dotenv parser: KEY=VALUE, tolerates `export KEY=`, CRLF, surrounding quotes, trailing ` # comment`.
function parseEnv(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes('=')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '').trim();
    out[m[1]] = v;
  }
  return out;
}

// self-hosted takes precedence (needs BOTH markers); else cloud if any cloud marker is set.
function detectMode(env) {
  if (env.CONVEX_SELF_HOSTED_URL && env.CONVEX_SELF_HOSTED_ADMIN_KEY) return 'self-hosted';
  if (env.CONVEX_DEPLOY_KEY || env.CONVEX_DEPLOYMENT || env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_DEPLOY_KEY) return 'cloud';
  return null;
}

// Locate the app dir that owns ./convex, preferring one that yields a deploy mode (dual-dir repos).
function resolveTarget(repo) {
  const cands = process.env.CONVEX_DIR ? [process.env.CONVEX_DIR] : ['.', 'web', 'app', 'apps/web'];
  const withConvex = cands.filter((d) => fs.existsSync(path.join(repo, d, 'convex')));
  if (!withConvex.length) return null;
  const built = withConvex.map((d) => { const env = parseEnv(path.join(repo, d, '.env.local')); return { appDir: d, env, mode: detectMode(env) }; });
  return built.find((t) => t.mode) || built[0];
}

// pre-push stdin = lines "<localref> <localsha> <remoteref> <remotesha>". A delete has an all-zero
// local sha. Returns true only when EVERY pushed ref is a delete (nothing new to deploy).
function allDeletes(lines) {
  const rows = lines.map((l) => l.trim()).filter(Boolean);
  return rows.length > 0 && rows.every((l) => /^0+$/.test((l.split(/\s+/)[1]) || ''));
}
function isPureDeletePush() {
  if (process.stdin.isTTY) return false; // manual/dry run, not a real push
  try { return allDeletes(fs.readFileSync(0, 'utf8').split(/\r?\n/)); } catch { return false; }
}

function main() {
  const dry = process.argv.includes('--dry-run');
  const repo = process.cwd();

  const target = resolveTarget(repo);
  if (!target) process.exit(0); // no Convex in this repo → nothing to guard
  const { appDir, env, mode } = target;

  if (!dry && isPureDeletePush()) process.exit(0); // branch deletion pushes nothing to deploy

  const base = process.env.SCGIT_DIFF_BASE || diffBase(repo); // override = test/CI seam
  if (base) {
    const changed = git(['diff', '--name-only', `${base}..HEAD`, '--', path.join(appDir, 'convex')], repo);
    if (changed !== null && changed.trim() === '') process.exit(0); // push doesn't touch convex/ → no-op
  }

  if (!mode) {
    say(`${C.ylw}⚠ convex/ changed but no deploy config in ${appDir}/.env.local — skipping Convex deploy.${C.rst}`);
    say(`  Set CONVEX_DEPLOY_KEY (cloud) or CONVEX_SELF_HOSTED_URL + CONVEX_SELF_HOSTED_ADMIN_KEY (self-hosted) to auto-deploy.`);
    process.exit(0); // a config gap shouldn't hard-block the push; warn loudly instead
  }

  const cwd = path.join(repo, appDir);
  const usePnpm = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'));
  const [cmd, cmdArgs] = usePnpm ? ['pnpm', ['exec', 'convex', 'deploy', '--yes']] : ['npx', ['convex', 'deploy', '--yes']];

  if (dry) {
    say(`${C.dim}[dry-run] appDir=${appDir} mode=${mode} base=${base || '(none → would deploy)'} runner="${cmd} ${cmdArgs.join(' ')}"${C.rst}`);
    say(`${C.dim}[dry-run] would deploy ${mode} Convex from ${cwd} — no deploy performed.${C.rst}`);
    process.exit(0);
  }

  say(`\n▶ sc-git: convex/ changed → deploying ${mode} Convex FIRST (${appDir})`);
  // node 22+ ships --use-system-ca: trust the OS cert store (what curl/openssl use) so the convex
  // CLI's TLS survives a system/corporate CA that node's bundled store doesn't have.
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  const NODE_OPTIONS = [process.env.NODE_OPTIONS, nodeMajor >= 22 ? '--use-system-ca' : ''].filter(Boolean).join(' ');
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env: { ...process.env, ...env, NODE_OPTIONS } });
  if (res.status !== 0) {
    say(`\n${C.red}❌ Convex ${mode} deploy failed. push aborted — frontend must not land ahead of backend.${C.rst}`);
    say(`   Fix the Convex deploy first; do NOT bypass with --no-verify.`);
    process.exit(1);
  }
  say(`${C.grn}✓ Convex ${mode} deploy complete. Continuing push.${C.rst}`);
  process.exit(0);
}

function selfTest() {
  const assert = (c, m) => { if (!c) { say(`${C.red}FAIL: ${m}${C.rst}`); process.exit(1); } };
  // parseEnv across CRLF, export, quotes, inline comments, '=' in value
  const tmp = path.join(require('os').tmpdir(), `cvx-selftest-${process.pid}.env`);
  fs.writeFileSync(tmp, [
    '# comment', 'CONVEX_DEPLOYMENT=dev:woozy-cow-48 # team: x', 'NEXT_PUBLIC_CONVEX_URL="https://a.convex.cloud"',
    "QUOTED='bar'", 'EMPTY=', 'export CONVEX_SELF_HOSTED_ADMIN_KEY=k', 'KEY_WITH_EQ=a=b=c',
  ].join('\r\n')); // CRLF on purpose
  const e = parseEnv(tmp); fs.unlinkSync(tmp);
  assert(e.CONVEX_DEPLOYMENT === 'dev:woozy-cow-48', 'CRLF + inline # comment');
  assert(e.NEXT_PUBLIC_CONVEX_URL === 'https://a.convex.cloud', 'double quotes');
  assert(e.QUOTED === 'bar', 'single quotes');
  assert(e.EMPTY === '', 'empty value');
  assert(e.CONVEX_SELF_HOSTED_ADMIN_KEY === 'k', '`export KEY=` prefix (self-hosted parity)');
  assert(e.KEY_WITH_EQ === 'a=b=c', 'value may contain = signs');
  // detectMode
  assert(detectMode(e) === 'cloud', 'partial self-hosted (only ADMIN_KEY) + cloud markers → cloud');
  assert(detectMode({ CONVEX_SELF_HOSTED_URL: 'u', CONVEX_SELF_HOSTED_ADMIN_KEY: 'k', CONVEX_DEPLOYMENT: 'd' }) === 'self-hosted', 'both self-hosted markers win over cloud');
  assert(detectMode({ CONVEX_DEPLOYMENT: 'x' }) === 'cloud', 'cloud from CONVEX_DEPLOYMENT');
  assert(detectMode({ CONVEX_SELF_HOSTED_URL: 'x' }) === null, 'self-hosted needs BOTH markers');
  assert(detectMode({}) === null, 'no markers → null (no-op)');
  // allDeletes (delete-branch push detection)
  assert(allDeletes(['(delete) 0000000000000000000000000000000000000000 refs/heads/x 0000000000000000000000000000000000000000']), 'pure delete push detected');
  assert(!allDeletes(['refs/heads/main abc123 refs/heads/main def456']), 'normal push is not all-deletes');
  assert(!allDeletes([]), 'empty stdin is not a delete push');
  say(`${C.grn}✓ convex-deploy self-test passed${C.rst}`);
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
