'use strict';

// sc-sync coverage:
//   route()          — direction x role -> {src,dst,isSrc,isDst,mode,other}
//                       must match the routing table exactly. Role is who's
//                       RUNNING the command (SYNC_ROLE), never sniffed via
//                       `hostname` (personal-identifier leak + fragility).
//   isBlockedPath()   — noise dirs (node_modules, .git, dist, ...) excluded
//                       as full path segments, not substrings.
//   filterBlocked()   — same, applied to a list.
//
// Node built-ins only (node:test + node:assert). No network, no fs, no
// hardcoded personal hostnames/IPs — generic 'vps'/'local' role labels only.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { route, isBlockedPath, filterBlocked, parseArgs } = require('../skills/sc-sync/scripts/_shared.js');

// ---------------------------------------------------------------------------
// route() — the 4-cell table from the skill spec, verbatim
// ---------------------------------------------------------------------------
test('route: direction=vps-local, role=vps -> this machine is SRC (push to local)', () => {
  const r = route('vps-local', 'vps');
  assert.equal(r.src, 'vps');
  assert.equal(r.dst, 'local');
  assert.equal(r.isSrc, true);
  assert.equal(r.isDst, false);
  assert.equal(r.mode, 'push');
  assert.equal(r.other, 'local', 'the other end of the wire is local');
});

test('route: direction=vps-local, role=local -> this machine is DST (pull from vps)', () => {
  const r = route('vps-local', 'local');
  assert.equal(r.src, 'vps');
  assert.equal(r.dst, 'local');
  assert.equal(r.isSrc, false);
  assert.equal(r.isDst, true);
  assert.equal(r.mode, 'pull');
  assert.equal(r.other, 'vps');
});

test('route: direction=local-vps, role=local -> this machine is SRC (push to vps)', () => {
  const r = route('local-vps', 'local');
  assert.equal(r.src, 'local');
  assert.equal(r.dst, 'vps');
  assert.equal(r.isSrc, true);
  assert.equal(r.isDst, false);
  assert.equal(r.mode, 'push');
  assert.equal(r.other, 'vps');
});

test('route: direction=local-vps, role=vps -> this machine is DST (pull from local)', () => {
  const r = route('local-vps', 'vps');
  assert.equal(r.src, 'local');
  assert.equal(r.dst, 'vps');
  assert.equal(r.isSrc, false);
  assert.equal(r.isDst, true);
  assert.equal(r.mode, 'pull');
  assert.equal(r.other, 'local');
});

test('route: rejects an invalid direction', () => {
  assert.throws(() => route('local-local', 'vps'), /invalid direction/);
});

test('route: rejects an invalid role (e.g. a sniffed hostname, not vps|local)', () => {
  assert.throws(() => route('vps-local', 'some-machine-hostname'), /invalid role/);
});

// ---------------------------------------------------------------------------
// isBlockedPath() / filterBlocked() — noise-dir exclusion
// ---------------------------------------------------------------------------
test('isBlockedPath: matches every blocked dir as a full path segment', () => {
  const blocked = [
    'node_modules/pkg/index.js',
    '.git/hooks/pre-commit',
    'dist/bundle.js',
    'build/out.js',
    '.next/cache/x.json',
    '.turbo/cache/x',
    '.venv/lib/python3/site.py',
    'venv/lib/python3/site.py',
    '__pycache__/mod.cpython.pyc',
    'target/release/app',
    'vendor/pkg/file.go',
    'coverage/lcov.info',
    '.cache/tool/x',
    'apps/web/node_modules/pkg/index.js', // nested, not just top-level
  ];
  for (const p of blocked) {
    assert.equal(isBlockedPath(p), true, `expected blocked: ${p}`);
  }
});

test('isBlockedPath: does NOT false-positive on similarly-named files/dirs', () => {
  const allowed = [
    'docs/notes.md',
    'vendors/file.js',        // "vendors" != "vendor" as a segment
    'my-vendor-notes.md',     // substring match must not trigger
    '.venvrc',                // not the ".venv" segment
    'targeting/plan.md',      // "targeting" != "target"
    'buildkite/pipeline.yml', // "buildkite" != "build"
  ];
  for (const p of allowed) {
    assert.equal(isBlockedPath(p), false, `expected NOT blocked: ${p}`);
  }
});

test('filterBlocked: drops blocked entries and keeps the rest, in order', () => {
  const input = [
    'docs/private-notes.md',
    'node_modules/pkg/index.js',
    '.env.local',
    'dist/out.js',
    'scratch/todo.txt',
  ];
  const out = filterBlocked(input);
  assert.deepEqual(out, ['docs/private-notes.md', '.env.local', 'scratch/todo.txt']);
});

test('filterBlocked: drops falsy/empty entries', () => {
  assert.deepEqual(filterBlocked(['a.txt', '', null, undefined, 'b.txt']), ['a.txt', 'b.txt']);
});

// ---------------------------------------------------------------------------
// parseArgs — direction/paths land in `_`, --apply is a boolean flag
// ---------------------------------------------------------------------------
test('parseArgs: direction positional + --apply boolean + trailing path args', () => {
  const o = parseArgs(['vps-local', '--apply', 'docs/a.md', 'docs/b.md']);
  assert.deepEqual(o._, ['vps-local', 'docs/a.md', 'docs/b.md']);
  assert.equal(o.apply, true);
});

test('parseArgs: dry-run by default (no --apply present)', () => {
  const o = parseArgs(['local-vps']);
  assert.deepEqual(o._, ['local-vps']);
  assert.equal(o.apply, undefined);
});
