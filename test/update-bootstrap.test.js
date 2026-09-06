'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

test('SKBOOT-1: legacy bin/sc.js exposes the same slash registry as the new entry wrapper', () => {
  for (const entry of ['bin/sc.js', 'bin/sc-entry.js']) {
    const r = spawnSync(process.execPath, [path.join(ROOT, entry), 'skills', '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.contract.list, '/skills');
    assert.ok(out.skills.some(row => row.invocation === '/sc-fe'));
  }
});

test('SKBOOT-2: legacy bin/sc.js keeps sc skill verify and adds sc skill list', () => {
  const list = spawnSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'skill', 'list', '--json'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.ok(JSON.parse(list.stdout).skills.length > 0);
  const verify = spawnSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'skill', 'verify', '--strict', '--json'], { encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
  assert.equal(JSON.parse(verify.stdout).ok, true);
});

test('SKBOOT-3: updated self-heal exposes npm-link result without making fast-forward semantics destructive', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/update.js'), 'utf8');
  assert.match(source, /refreshCliLink/);
  assert.match(source, /merge', '--ff-only'/);
  assert.doesNotMatch(source, /reset', '--hard'/);
});
