const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

test('DIST-1: Anthropic marketplace exposes the full SI-Coder plugin from this repository', () => {
  const m = readJson('.claude-plugin/marketplace.json');
  assert.strictEqual(m.name, 'si-coder-marketplace');
  const plugin = m.plugins.find(x => x.name === 'si-coder');
  assert.ok(plugin);
  assert.strictEqual(plugin.source, './');
  assert.ok(plugin.skills.includes('./skills/sc'));
  assert.ok(plugin.skills.includes('./skills/sc-build'));
});

test('DIST-2: web skill package is a ZIP-format .skill with one self-contained sc skill', () => {
  const skill = path.join(ROOT, 'dist/sc.skill');
  const zip = path.join(ROOT, 'dist/sc.zip');
  assert.ok(fs.existsSync(skill));
  assert.deepStrictEqual(fs.readFileSync(skill), fs.readFileSync(zip));
  const names = JSON.parse(execFileSync('python3', ['-c', [
    'import json,sys,zipfile',
    'with zipfile.ZipFile(sys.argv[1]) as z: print(json.dumps(z.namelist()))',
  ].join('\n'), skill], { encoding: 'utf8' }));
  assert.ok(names.includes('sc/SKILL.md'));
  assert.ok(names.includes('sc/agents/openai.yaml'));
  assert.ok(names.includes('sc/references/si-coder/sc-build.md'));
  assert.ok(names.includes('sc/references/si-coder/sc-all.md'));
  assert.ok(names.includes('sc/references/si-coder/sc-provider.md'));
});

test('DIST-3: generated manifest fingerprints every web artifact', () => {
  const m = readJson('dist/manifest.json');
  assert.strictEqual(m.format, 'agent-skills');
  for (const name of ['sc.skill', 'sc.zip', 'sc-build.skill']) {
    const row = m.artifacts.find(x => x.file === name);
    assert.ok(row, name);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert.ok(row.bytes > 0);
  }
});

test('DIST-4: OpenAI UI metadata exists for main skills and uses current explicit syntax guidance', () => {
  for (const name of ['sc', 'sc-build']) {
    const text = fs.readFileSync(path.join(ROOT, `skills/${name}/agents/openai.yaml`), 'utf8');
    assert.match(text, /display_name:/);
    assert.match(text, /short_description:/);
    assert.match(text, /default_prompt:/);
  }
  const install = fs.readFileSync(path.join(ROOT, 'AI_INSTALL.md'), 'utf8');
  assert.match(install, /Claude Code/);
  assert.match(install, /ChatGPT Web/);
  assert.match(install, /@SI-Coder/);
  assert.match(install, /dist\/sc\.skill/);
  assert.match(install, /Do not promise `\/sc` on ChatGPT Web/);
});

test('DIST-5: version and package file list include distributable skill artifacts', () => {
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.strictEqual(pkg.version, '0.8.0');
  assert.strictEqual(plugin.version, '0.8.0');
  assert.ok(pkg.files.includes('dist/'));
  assert.ok(pkg.files.includes('AI_INSTALL.md'));
  assert.strictEqual(pkg.scripts['package:skills'], 'python3 scripts/package-web-skill.py');
});
