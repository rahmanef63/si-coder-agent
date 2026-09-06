'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');
const { listSkills, resolveSkill } = require('../lib/skill-registry');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'bin/sc-entry.js');

function run(...args) {
  return execFileSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('SKREG-1: catalog-backed registry exposes active/default slash skills', () => {
  const rows = listSkills();
  const names = rows.map(row => row.name);
  for (const required of ['sc', 'sc-all', 'sc-ui', 'sc-ux', 'sc-dx', 'sc-ax', 'sc-fe']) {
    assert.ok(names.includes(required), required);
  }
  for (const row of rows) {
    assert.strictEqual(row.lifecycle, 'active');
    assert.strictEqual(row.installByDefault, true);
    assert.strictEqual(row.invocation, `/${row.name}`);
    assert.strictEqual(row.source, 'si-coder');
  }
  assert.ok(!names.includes('sc-resend'));
  assert.strictEqual(resolveSkill('/sc-fe').name, 'sc-fe');
});

test('SKREG-2: sc skills --json is a portable slash registry contract', () => {
  const out = JSON.parse(run('skills', '--json'));
  assert.strictEqual(out.version, 1);
  assert.strictEqual(out.source, 'si-coder');
  assert.strictEqual(out.contract.list, '/skills');
  assert.strictEqual(out.contract.direct, '/<skill> [prompt]');
  assert.strictEqual(out.contract.exact, '/skill <exact-id> [prompt]');
  assert.ok(out.skills.some(row => row.name === 'sc-fe' && row.invocation === '/sc-fe'));
});

test('SKREG-3: sc skill list is an alias and normal SC commands still delegate', () => {
  const direct = JSON.parse(run('skills', '--json'));
  const alias = JSON.parse(run('skill', 'list', '--json'));
  assert.deepStrictEqual(alias, direct);
  const help = run('help');
  assert.match(help, /sc — SI-Coder/);
});

test('SKREG-4: npm bin points at the slash-aware entry wrapper', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.bin.sc, 'bin/sc-entry.js');
});
