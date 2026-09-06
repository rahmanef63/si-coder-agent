'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Registry = require('../lib/skill-registry');
const Store = require('../lib/skill-store');

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-skill-crud-'));
  return {
    temp,
    options: {
      projectRoot: path.join(temp, 'project'),
      globalRoot: path.join(temp, 'global-skills'),
    },
    cleanup: () => fs.rmSync(temp, { recursive: true, force: true }),
  };
}

test('SKCRUD-1: project skill supports create, read, update and delete', () => {
  const f = fixture();
  try {
    const created = Store.createSkill({ name: 'client-review', description: 'Review client-facing UI before release.' }, f.options);
    assert.equal(created.id, 'project:client-review');
    assert.equal(created.mutable, true);
    assert.equal(Registry.resolveSkill('client-review', f.options).id, 'project:client-review');

    const shown = Store.showSkill('client-review', { ...f.options, includeContent: true });
    assert.match(shown.content, /Review client-facing UI/);

    const updated = Store.updateSkill('project:client-review', { description: 'Audit client UI, UX, and release readiness.' }, f.options);
    assert.equal(updated.description, 'Audit client UI, UX, and release readiness.');

    const deleted = Store.deleteSkill('project:client-review', f.options);
    assert.equal(deleted.deleted, true);
    assert.equal(Registry.resolveSkill('project:client-review', f.options), null);
  } finally { f.cleanup(); }
});

test('SKCRUD-2: global managed skill is discoverable and project name wins precedence', () => {
  const f = fixture();
  try {
    Store.createSkill({ name: 'same-name', description: 'Global version.', scope: 'global' }, f.options);
    Store.createSkill({ name: 'same-name', description: 'Project version.', scope: 'project' }, f.options);
    const rows = Registry.listSkills(f.options).filter(row => row.name === 'same-name');
    assert.deepEqual(rows.map(row => row.id), ['project:same-name', 'global:same-name']);
    assert.equal(Registry.resolveSkill('same-name', f.options).id, 'project:same-name');
    assert.equal(Registry.resolveSkill('global:same-name', f.options).description, 'Global version.');
  } finally { f.cleanup(); }
});

test('SKCRUD-3: bundled skills are read-only', () => {
  assert.throws(() => Store.updateSkill('sc-fe', { description: 'nope' }), /read-only/);
  assert.throws(() => Store.deleteSkill('sc-fe'), /read-only/);
});

test('SKCRUD-4: invalid replacement rolls back the previous skill', () => {
  const f = fixture();
  try {
    Store.createSkill({ name: 'rollback-test', description: 'Original.' }, f.options);
    const bad = path.join(f.temp, 'bad.md');
    fs.writeFileSync(bad, '---\nname: different-name\ndescription: "bad"\n---\n');
    assert.throws(() => Store.updateSkill('rollback-test', { fromFile: bad }, f.options), /name must remain/);
    assert.equal(Store.showSkill('rollback-test', f.options).description, 'Original.');
  } finally { f.cleanup(); }
});

test('SKCRUD-5: symlink to bundled SC skill does not duplicate registry rows', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.options.globalRoot, { recursive: true });
    fs.symlinkSync(path.join(Registry.SKILLS_ROOT, 'sc-fe'), path.join(f.options.globalRoot, 'sc-fe'), 'dir');
    const rows = Registry.listSkills(f.options).filter(row => row.name === 'sc-fe');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope, 'bundled');
  } finally { f.cleanup(); }
});
