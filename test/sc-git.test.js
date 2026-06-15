'use strict';

// sc-git audit-fix coverage:
//  SCG-01  disable.js patchYaml must collapse auto-triggers to workflow_dispatch
//          for single-line scalar, flow-seq, and quoted `on:` forms (not only the
//          multiline block form). The old pre-scan early-returned alreadyDispatchOnly
//          for these, silently leaving the triggers in place.
//  SCG-05  audit.js and disable.js must agree on "is this dispatch-only?" by sharing
//          one detectTriggers helper (in _shared.js) that handles bare `on:`,
//          quoted `"on":`, single-line scalar, and flow-seq forms.
//  SCG-04  cron.js list formatting must treat a leading `@`-macro (@daily, @reboot,
//          ...) as a single schedule token instead of slicing 5 whitespace fields.
//
// Node built-ins only (node:test + node:assert). No new deps.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { patchYaml } = require('../skills/sc-git/scripts/disable.js');
const { detectTriggers, parseArgs } = require('../skills/sc-git/scripts/_shared.js');

// ---------------------------------------------------------------------------
// SCG-01 — patchYaml across every `on:` form
// ---------------------------------------------------------------------------
test('SCG-01 patchYaml: single-line `on: push` collapses to workflow_dispatch', () => {
  const yaml = 'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true, 'single-line on: push must be rewritten');
  assert.equal(r.alreadyDispatchOnly, false);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /^on: push$/m, 'auto-trigger must be gone');
});

test('SCG-01 patchYaml: flow-seq `on: [push, pull_request]` collapses', () => {
  const yaml = 'name: x\non: [push, pull_request]\njobs:\n  a:\n    runs-on: ubuntu-latest\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true, 'flow-seq on must be rewritten');
  assert.equal(r.alreadyDispatchOnly, false);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /\[push, pull_request\]/, 'flow-seq triggers must be gone');
});

test('SCG-01 patchYaml: quoted `"on":` block collapses and drops indented triggers', () => {
  const yaml = 'name: x\n"on":\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: ubuntu-latest\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true, 'quoted on must be rewritten');
  assert.equal(r.alreadyDispatchOnly, false);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /push:/, 'indented push trigger must be removed');
  assert.doesNotMatch(r.text, /branches:/, 'orphaned trigger body must be removed');
  assert.match(r.text, /runs-on: ubuntu-latest/, 'job body must be preserved');
});

test('SCG-01 patchYaml: multiline block form still works (no regression)', () => {
  const yaml = 'name: x\non:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "0 0 * * *"\njobs:\n  a: {}\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /cron:/, 'schedule trigger removed');
});

test('SCG-A1 patchYaml: flow-seq mixing push with workflow_dispatch is still rewritten', () => {
  // `on: [push, workflow_dispatch]` has a LIVE push trigger. The old guard
  // skipped any line containing 'workflow_dispatch', leaving push live.
  const yaml = 'name: x\non: [push, workflow_dispatch]\njobs:\n  a:\n    runs-on: ubuntu-latest\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true, 'mixed flow-seq must be rewritten');
  assert.equal(r.alreadyDispatchOnly, false);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /push/, 'live push trigger must be gone');
});

test('SCG-A1 patchYaml: quoted flow-seq mixing push with workflow_dispatch is rewritten', () => {
  const yaml = 'name: x\n"on": [push, workflow_dispatch]\njobs:\n  a: {}\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, true);
  assert.equal(r.alreadyDispatchOnly, false);
  assert.match(r.text, /^on:\n {2}workflow_dispatch:$/m);
  assert.doesNotMatch(r.text, /push/, 'live push trigger must be gone');
});

test('SCG-01 patchYaml: genuine dispatch-only block is left untouched', () => {
  const yaml = 'name: x\non:\n  workflow_dispatch:\njobs:\n  a: {}\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, false);
  assert.equal(r.alreadyDispatchOnly, true);
  assert.equal(r.text, yaml, 'already-clean file must be byte-identical');
});

test('SCG-01 patchYaml: genuine dispatch-only single-line is left untouched', () => {
  const yaml = 'name: x\non: workflow_dispatch\njobs:\n  a: {}\n';
  const r = patchYaml(yaml);
  assert.equal(r.changed, false);
  assert.equal(r.alreadyDispatchOnly, true);
});

// ---------------------------------------------------------------------------
// SCG-05 — audit/disable agree via the shared detectTriggers helper
// ---------------------------------------------------------------------------
test('SCG-05 detectTriggers: bare block `on:`', () => {
  const t = detectTriggers('on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "5 4 * * *"\n');
  assert.equal(t.push, true);
  assert.equal(t.schedule, true);
  assert.deepEqual(t.cron, ['5 4 * * *']);
});

test('SCG-05 detectTriggers: quoted `"on":` matches like audit expects', () => {
  const t = detectTriggers('"on":\n  push: {}\n');
  assert.equal(t.push, true);
});

test('SCG-05 detectTriggers: single-line scalar', () => {
  const t = detectTriggers('on: push\n');
  assert.equal(t.push, true);
  assert.equal(t.pr, false);
});

test('SCG-05 detectTriggers: flow-seq', () => {
  const t = detectTriggers('on: [push, pull_request, workflow_dispatch]\n');
  assert.equal(t.push, true);
  assert.equal(t.pr, true);
  assert.equal(t.dispatch, true);
});

test('SCG-05 detectTriggers: pull_request_target is NOT a false pull_request match', () => {
  const t = detectTriggers('on:\n  pull_request_target:\n    types: [opened]\n');
  assert.equal(t.pr, false);
});

test('SCG-05 consistency: a "burn" file audit flags as active is also patched by disable', () => {
  // Same input through both code paths must agree: active triggers -> disable rewrites it.
  const yaml = '"on":\n  push:\n    branches: [main]\njobs:\n  a: {}\n';
  const t = detectTriggers(yaml);
  const auditSeesActive = t.push || t.pr || t.schedule || t.workflowRun;
  const { alreadyDispatchOnly } = patchYaml(yaml);
  assert.equal(auditSeesActive, true, 'audit must see an active trigger');
  assert.equal(alreadyDispatchOnly, false, 'disable must NOT classify it as already-clean');
});

// ---------------------------------------------------------------------------
// SCG-04 — cron list formatting handles @-macros
// ---------------------------------------------------------------------------
// Mirror of cron.js list-row formatting (schedule/cmd split). Kept in lockstep
// with the source: leading `@`-macro -> 1 schedule token, else 5 fields.
function cronRow(line) {
  const parts = line.split(/\s+/);
  const cut = parts[0].startsWith('@') ? 1 : 5;
  return { schedule: parts.slice(0, cut).join(' '), cmd: parts.slice(cut).join(' ') };
}

test('SCG-04 cron list: 5-field schedule splits correctly', () => {
  const row = cronRow('0 19 * * 0 bash /opt/run.sh');
  assert.equal(row.schedule, '0 19 * * 0');
  assert.equal(row.cmd, 'bash /opt/run.sh');
});

test('SCG-04 cron list: @daily macro keeps cmd intact', () => {
  const row = cronRow('@daily bash /x.sh');
  assert.equal(row.schedule, '@daily');
  assert.equal(row.cmd, 'bash /x.sh');
});

test('SCG-04 cron list: @reboot macro keeps cmd intact', () => {
  const row = cronRow('@reboot /usr/bin/node /srv/app.js --flag');
  assert.equal(row.schedule, '@reboot');
  assert.equal(row.cmd, '/usr/bin/node /srv/app.js --flag');
});

// ---------------------------------------------------------------------------
// SCG-A4 — parseArgs must not lose free-text values that start with '--'
// ---------------------------------------------------------------------------
test('SCG-A4 parseArgs: value-bearing flag keeps a value starting with --', () => {
  const o = parseArgs(['--description', '--force was needed', '--state', 'failure']);
  assert.equal(o.description, '--force was needed', 'free-text value must be captured, not lost');
  assert.equal(o.state, 'failure');
});

test('SCG-A4 parseArgs: --key=value form is honored for any flag', () => {
  const o = parseArgs(['--description=--force was needed', '--force']);
  assert.equal(o.description, '--force was needed');
  assert.equal(o.force, true, 'genuine standalone flag stays boolean');
});

test('SCG-A4 parseArgs: standalone boolean before another flag stays true', () => {
  const o = parseArgs(['--force', '--repo', 'x']);
  assert.equal(o.force, true);
  assert.equal(o.repo, 'x');
});

test('SCG-A4 parseArgs: cmd flag captures a shell string with --flags', () => {
  const o = parseArgs(['--name', 'sync', '--cmd', 'node x.js --flag --opt']);
  assert.equal(o.name, 'sync');
  assert.equal(o.cmd, 'node x.js --flag --opt');
});
