const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const FRONTEND = ['sc-fe', 'sc-ui', 'sc-ux', 'sc-dx', 'sc-ax'];

test('FE-1: frontend quality skills are active default catalog capabilities', () => {
  const rows = json('skills/catalog.json').skills;
  for (const name of FRONTEND) {
    assert.deepStrictEqual(rows[name], { lifecycle: 'active', installByDefault: true }, name);
    const text = read(`skills/${name}/SKILL.md`);
    assert.match(text, new RegExp(`name: ${name.replace('-', '\\-')}`));
  }
});

test('FE-2: sc-fe supports presets, reusable project profiles, existing-design preservation and scope locks', () => {
  const skill = read('skills/sc-fe/SKILL.md');
  const profiles = read('skills/sc-fe/references/profiles.md');
  for (const token of ['--apple', '--workbench', '--profile <name>', '--save-profile <name>', '--existing', '--fresh', '--density', '--motion', '--strict']) {
    assert.ok(skill.includes(token), token);
  }
  assert.match(skill, /preserve.*design DNA/i);
  assert.match(skill, /scope lock/i);
  assert.match(skill, /\.sc\/frontend\/profiles\/<name>\.json/);
  for (const preset of ['apple', 'workbench', 'linear', 'notion', 'vercel', 'material', 'editorial', 'terminal']) {
    assert.match(profiles, new RegExp(`--${preset}`));
  }
  assert.match(profiles, /not visual cloning/i);
});

test('FE-3: sc-all delegates applicable user-facing frontend completion to sc-fe', () => {
  const all = read('skills/sc-all/SKILL.md');
  assert.match(all, /Frontend quality delegation/i);
  assert.match(all, /delegate to `sc-fe`/i);
  assert.match(all, /scope exclusions are hard locks/i);
  assert.match(all, /compilation alone is not sufficient evidence/i);
});

test('FE-4: main sc and umbrella route frontend quality without forcing users to choose an axis', () => {
  const sc = read('skills/sc/SKILL.md');
  const umbrella = read('SKILL.md');
  for (const name of FRONTEND) {
    assert.ok(sc.includes(name), `sc route missing ${name}`);
    assert.ok(umbrella.includes(name), `umbrella route missing ${name}`);
  }
  assert.match(sc, /Do not ask the user to choose a SI-Coder sub-skill/);
});

test('FE-5: OpenAI plugin copies every active/default skill from the catalog and copies stay canonical', () => {
  const rows = json('skills/catalog.json').skills;
  const active = Object.entries(rows)
    .filter(([, row]) => row.lifecycle === 'active' && row.installByDefault)
    .map(([name]) => name);
  for (const name of active) {
    const source = read(`skills/${name}/SKILL.md`);
    const generated = read(`plugins/si-coder/skills/${name}/SKILL.md`);
    assert.strictEqual(generated, source, `${name} generated plugin copy drifted`);
  }
  const packager = read('scripts/package-web-skill.py');
  assert.match(packager, /OPENAI_PLUGIN_SKILLS = active_default_skills\(\)/);
  assert.match(packager, /skills.*catalog\.json/s);
});
