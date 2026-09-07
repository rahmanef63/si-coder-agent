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

function assertInstalled(root, copied = false) {
  for (const skill of active) {
    const target = path.join(root, skill);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), !copied, `${target} should use the runtime's supported transport`);
    if (copied) assert.ok(fs.lstatSync(target).isDirectory());
    assert.ok(fs.existsSync(path.join(target, 'SKILL.md')), `${skill} should resolve to SKILL.md`);
  }
}

test('MSO-INSTALL-1: --agent mso installs active skills into the trusted ~/.mso/skills root', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mso-home-'));
  try {
    const output = install('mso', home);
    const root = path.join(home, '.mso', 'skills');
    assertInstalled(root, true);
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
    ]) assertInstalled(root, root === path.join(home, '.mso', 'skills'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const { installMsoSkill } = require('../scripts/install-mso-skill');
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mso-bundle-'));
  const source = path.join(root, 'source', 'example');
  const target = path.join(root, 'installed');
  fs.mkdirSync(path.join(source, 'references'), { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: example\ndescription: Example\n---\nRead references/guide.md');
  fs.writeFileSync(path.join(source, 'references/guide.md'), 'original');
  try { fn({ source, target, destination: path.join(target, 'example') }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('MSO-INSTALL-3: migrates its exact legacy symlink and refreshes complete managed bundles', () => fixture(({ source, target, destination }) => {
  fs.mkdirSync(target);
  fs.symlinkSync(source, destination);
  installMsoSkill(source, target);
  assert.equal(fs.lstatSync(destination).isSymbolicLink(), false);
  fs.writeFileSync(path.join(source, 'references/guide.md'), 'updated');
  installMsoSkill(source, target);
  assert.equal(fs.readFileSync(path.join(destination, 'references/guide.md'), 'utf8'), 'updated');
  assert.equal(fs.readFileSync(path.join(source, 'references/guide.md'), 'utf8'), 'updated');
}));
test('MSO-INSTALL-4: refuses local bundle edits and unmanaged directories', () => fixture(({ source, target, destination }) => {
  installMsoSkill(source, target);
  fs.writeFileSync(path.join(destination, 'references/guide.md'), 'operator edit');
  assert.throws(() => installMsoSkill(source, target), /modified/);
  assert.equal(fs.readFileSync(path.join(destination, 'references/guide.md'), 'utf8'), 'operator edit');
  fs.unlinkSync(path.join(destination, '.si-coder-install.json'));
  assert.throws(() => installMsoSkill(source, target), /unmanaged/);
}));
test('MSO-INSTALL-5: refuses unrelated links and linked bundle resources', () => fixture(({ source, target, destination }) => {
  fs.mkdirSync(target);
  fs.symlinkSync(path.dirname(source), destination);
  assert.throws(() => installMsoSkill(source, target), /unrelated/);
  fs.unlinkSync(destination);
  fs.symlinkSync('/etc/passwd', path.join(source, 'references/unsafe'));
  assert.throws(() => installMsoSkill(source, target), /symlink/);
  assert.equal(fs.existsSync(destination), false);
}));
