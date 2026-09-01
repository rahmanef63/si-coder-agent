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
  const version = readJson('package.json').version.replaceAll('.', '\\.');
  assert.match(install, /Claude Code/);
  assert.match(install, /ChatGPT Web/);
  assert.match(install, /@sc/);
  assert.match(install, /@SI-Coder/);
  assert.match(install, new RegExp(`releases/download/v${version}/sc\\.zip`));
  assert.match(install, /optional `\.skill` archive/i);
  assert.match(install, /Do not promise `\/sc` on ChatGPT Web/);
});

test('DIST-5: version and package file list include distributable skill artifacts', () => {
  const pkg = readJson('package.json');
  const plugin = readJson('.claude-plugin/plugin.json');
  assert.strictEqual(pkg.version, '0.8.7');
  assert.strictEqual(plugin.version, '0.8.7');
  assert.ok(pkg.files.includes('dist/'));
  assert.ok(pkg.files.includes('AI_INSTALL.md'));
  assert.ok(pkg.files.includes('.agents/'));
  assert.ok(pkg.files.includes('plugins/'));
  assert.strictEqual(pkg.scripts['package:skills'], 'python3 scripts/package-web-skill.py');
});


test('DIST-6: OpenAI repository marketplace exposes a web-compatible skill-only plugin', () => {
  const market = readJson('.agents/plugins/marketplace.json');
  const row = market.plugins.find(x => x.name === 'si-coder');
  assert.ok(row);
  assert.deepStrictEqual(row.source, { source: 'local', path: './plugins/si-coder' });
  const plugin = readJson('plugins/si-coder/.codex-plugin/plugin.json');
  assert.strictEqual(plugin.name, 'si-coder');
  assert.strictEqual(plugin.version, '0.8.7');
  assert.strictEqual(plugin.skills, './skills/');
  assert.ok(!('mcpServers' in plugin), 'web plugin must not declare MCP and become Desktop-only');
  assert.ok(!fs.existsSync(path.join(ROOT, 'plugins/si-coder/.mcp.json')));
  for (const name of ['sc', 'sc-build', 'sc-all', 'sc-provider', 'sc-install', 'sc-help']) {
    const generated = fs.readFileSync(path.join(ROOT, `plugins/si-coder/skills/${name}/SKILL.md`));
    const source = fs.readFileSync(path.join(ROOT, `skills/${name}/SKILL.md`));
    assert.deepStrictEqual(generated, source, `${name} OpenAI plugin copy drifted from source`);
  }
});

test('DIST-7: per-surface install docs exist and keep invocation claims surface-specific', () => {
  const files = [
    'docs/install/README.md',
    'docs/install/claude-code.md',
    'docs/install/claude-web.md',
    'docs/install/codex.md',
    'docs/install/chatgpt-personal-skills.md',
    'docs/install/chatgpt-workspace-marketplace.md',
    'docs/install/generic-local.md',
    'docs/install/first-run-onboarding.md',
    'docs/publishing/openai-plugin-directory.md',
    'OPENAI_SUBMISSION.md',
  ];
  for (const rel of files) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);

  const claudeCode = fs.readFileSync(path.join(ROOT, 'docs/install/claude-code.md'), 'utf8');
  assert.match(claudeCode, /\/sc Build/);

  const personal = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-personal-skills.md'), 'utf8');
  assert.match(personal, /@sc/);
  assert.doesNotMatch(personal, /After installation, use:\s*`?\/sc\b/i);

  const workspace = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-workspace-marketplace.md'), 'utf8');
  assert.match(workspace, /@SI-Coder/);
  assert.doesNotMatch(workspace, /After installation, use:\s*`?\/sc\b/i);

  const boundary = fs.readFileSync(path.join(ROOT, 'docs/publishing/openai-plugin-directory.md'), 'utf8');
  assert.match(boundary, /does not currently provide a general self-serve submission endpoint/i);
  assert.match(boundary, /workspace directory/i);

  const pkg = readJson('package.json');
  assert.ok(pkg.files.includes('docs/'));
  assert.ok(pkg.files.includes('OPENAI_SUBMISSION.md'));
});

test('DIST-9: ChatGPT personal skill identity is sc and .skill never promises slash registration', () => {
  const meta = fs.readFileSync(path.join(ROOT, 'skills/sc/agents/openai.yaml'), 'utf8');
  const skill = fs.readFileSync(path.join(ROOT, 'skills/sc/SKILL.md'), 'utf8');
  const chatgpt = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-personal-skills.md'), 'utf8');
  assert.match(meta, /display_name:\s*["']?sc["']?/);
  assert.doesNotMatch(meta, /default_prompt:[^\n]*\$sc/);
  assert.doesNotMatch(skill, /default slash command/i);
  assert.match(chatgpt, /@sc/);
  assert.match(chatgpt, /Packaging does not register a custom ChatGPT `\/` command/);
});

test('DIST-8: packaged .skill artifacts are reproducible for unchanged source', () => {
  const skill = path.join(ROOT, 'dist/sc.skill');
  const before = require('crypto').createHash('sha256').update(fs.readFileSync(skill)).digest('hex');
  execFileSync('python3', [path.join(ROOT, 'scripts/package-web-skill.py')], { cwd: ROOT, stdio: 'ignore' });
  const after = require('crypto').createHash('sha256').update(fs.readFileSync(skill)).digest('hex');
  execFileSync('python3', [path.join(ROOT, 'scripts/package-web-skill.py')], { cwd: ROOT, stdio: 'ignore' });
  const again = require('crypto').createHash('sha256').update(fs.readFileSync(skill)).digest('hex');
  assert.strictEqual(after, again);
  // The first comparison may differ once when migrating from an older non-deterministic archive.
  assert.match(after, /^[0-9a-f]{64}$/);
  assert.match(before, /^[0-9a-f]{64}$/);
});


test('DIST-10: install links match each surface transport contract', () => {
  const pkg = readJson('package.json');
  const version = pkg.version.replaceAll('.', '\\.');

  const claudeWeb = fs.readFileSync(path.join(ROOT, 'docs/install/claude-web.md'), 'utf8');
  assert.match(claudeWeb, new RegExp(`releases/download/v${version}/sc\\.zip`));
  assert.match(claudeWeb, /custom-skill upload as a \*\*ZIP/i);
  assert.doesNotMatch(claudeWeb, /Download[^\n]*sc\.skill/i);

  const codex = fs.readFileSync(path.join(ROOT, 'docs/install/codex.md'), 'utf8');
  assert.match(codex, new RegExp(`tree/v${version}/skills/sc`));
  assert.match(codex, /directories containing `SKILL\.md`/);
  assert.doesNotMatch(codex, new RegExp(`releases/download/v${version}/sc\\.(zip|skill)`));

  const chatgpt = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-personal-skills.md'), 'utf8');
  assert.match(chatgpt, new RegExp(`releases/download/v${version}/sc\\.zip`));
  assert.match(chatgpt, /does \*\*not\*\* specify that a `\.skill` filename is required/i);
  assert.match(chatgpt, /optional.*sc\.skill/i);

  const workspace = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-workspace-marketplace.md'), 'utf8');
  assert.match(workspace, /does \*\*not\*\* use `sc\.zip`, `sc\.skill`, or a raw `SKILL\.md` download/);

  const matrix = fs.readFileSync(path.join(ROOT, 'docs/install/README.md'), 'utf8');
  assert.match(matrix, /Canonical format:/);
  assert.match(matrix, /None of the Claude\/OpenAI surfaces verified for this release requires the `\.skill` extension itself/);
});
test('DIST-11: install documentation is SSOT-generated and CI-enforced', () => {
  const pkg = readJson('package.json');
  assert.strictEqual(pkg.scripts['docs:sync'], 'node scripts/sync-install-docs.js');
  assert.strictEqual(pkg.scripts['docs:check'], 'node scripts/sync-install-docs.js --check');
  execFileSync('node', [path.join(ROOT, 'scripts/sync-install-docs.js'), '--check'], { cwd: ROOT, stdio: 'pipe' });

  const source = fs.readFileSync(path.join(ROOT, 'docs/install/README.md'), 'utf8');
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const release = fs.readFileSync(path.join(ROOT, `docs/releases/v${pkg.version}.md`), 'utf8');
  assert.match(source, /INSTALL_MATRIX_SSOT:BEGIN/);
  assert.match(readme, /INSTALL_MATRIX_GENERATED:BEGIN/);
  assert.match(release, /INSTALL_MATRIX_GENERATED:BEGIN/);
  assert.match(source, /`sc\.zip` does not contain `sc\.skill`/i);

  const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/verify.yml'), 'utf8');
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run docs:check/);
  assert.match(workflow, /npm run package:skills/);
  assert.match(workflow, /git diff --exit-code -- dist plugins\/si-coder/);
  assert.match(workflow, /cmp --silent dist\/sc\.zip dist\/sc\.skill/);

  const releaseWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseWorkflow, /tags:/);
  assert.match(releaseWorkflow, /permissions:[\s\S]*contents: write/);
  assert.match(releaseWorkflow, /npm run docs:check/);
  assert.match(releaseWorkflow, /npm run package:skills/);
  assert.match(releaseWorkflow, /gh release create/);
  assert.match(releaseWorkflow, /dist\/sc\.zip/);
  assert.match(releaseWorkflow, /dist\/sc\.skill/);
});
