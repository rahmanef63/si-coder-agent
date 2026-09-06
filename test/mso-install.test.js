'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const INSTALL = path.join(ROOT, 'install.sh');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/catalog.json'), 'utf8')).skills;
const active = Object.entries(catalog)
  .filter(([, row]) => row.lifecycle === 'active' && row.installByDefault)
  .map(([name]) => name);

function install(agent, home) {
  return execFileSync('bash', [INSTALL, '--agent', agent, '--no-onboard'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, SC_SKIP_NPM_LINK: '1' },
  });
}

function assertInstalled(root) {
  for (const skill of active) {
    const target = path.join(root, skill);
    assert.ok(fs.lstatSync(target).isSymbolicLink(), `${target} should be a symlink`);
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), `${skill} should resolve to SKILL.md`);
  }
}

test('MSO-INSTALL-1: --agent mso installs active skills into the trusted ~/.mso/skills root', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mso-home-'));
  try {
    const output = install('mso', home);
    const root = path.join(home, '.mso', 'skills');
    assertInstalled(root);
    assert.match(output, /\/sc-fe/);
    assert.match(output, /\/skills/);
    assert.match(output, /sc skills --json/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('MSO-INSTALL-2: --agent all includes MSO alongside the other supported registries', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-all-home-'));
  try {
    install('all', home);
    for (const root of [
      path.join(home, '.mso', 'skills'),
      path.join(home, '.claude', 'skills'),
      path.join(home, '.agents', 'skills'),
      path.join(home, '.hermes', 'skills'),
      path.join(home, '.openclaw', 'workspace', 'skills'),
    ]) assertInstalled(root);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
