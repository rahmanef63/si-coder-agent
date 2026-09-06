'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'bin/sc-entry.js');

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-skill-cli-'));
  const project = path.join(temp, 'project');
  const home = path.join(temp, 'home');
  const globalRoot = path.join(temp, 'global-skills');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  return { temp, project, home, globalRoot };
}

function run(f, ...args) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: f.project,
    encoding: 'utf8',
    env: { ...process.env, HOME: f.home, SC_SKILLS_ROOT: f.globalRoot },
  });
  return result;
}

test('SKCRUD-CLI-1: project skill CRUD is available through the sc binary and registry', () => {
  const f = fixture();
  try {
    let result = run(f, 'skill', 'create', 'release-check', '--description', 'Verify release readiness.', '--json');
    assert.equal(result.status, 0, result.stderr);
    let row = JSON.parse(result.stdout);
    assert.equal(row.id, 'project:release-check');
    assert.equal(row.invocation, '/release-check');

    result = run(f, 'skills', '--json');
    assert.equal(result.status, 0, result.stderr);
    const registry = JSON.parse(result.stdout);
    assert.ok(registry.skills.some(skill => skill.id === 'project:release-check'));

    result = run(f, 'skill', 'show', 'release-check', '--json');
    assert.equal(result.status, 0, result.stderr);
    row = JSON.parse(result.stdout);
    assert.equal(row.description, 'Verify release readiness.');

    result = run(f, 'skill', 'update', 'release-check', '--description', 'Verify release, security, and rollback readiness.', '--json');
    assert.equal(result.status, 0, result.stderr);
    row = JSON.parse(result.stdout);
    assert.equal(row.description, 'Verify release, security, and rollback readiness.');

    result = run(f, 'skill', 'delete', 'release-check', '--yes', '--json');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).deleted, true);

    result = run(f, 'skill', 'show', 'release-check', '--json');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown skill/i);
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});

test('SKCRUD-CLI-2: global scope uses explicit global root and bundled skills remain immutable', () => {
  const f = fixture();
  try {
    let result = run(f, 'skill', 'create', 'team-check', '--scope', 'global', '--description', 'Shared team release check.', '--json');
    assert.equal(result.status, 0, result.stderr);
    const row = JSON.parse(result.stdout);
    assert.equal(row.id, 'global:team-check');
    assert.ok(fs.existsSync(path.join(f.globalRoot, 'team-check', 'SKILL.md')));

    result = run(f, 'skill', 'delete', 'sc-fe', '--yes');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /read-only/i);
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});
