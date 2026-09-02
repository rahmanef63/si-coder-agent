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
  const catalog = readJson('skills/catalog.json').skills;
  const expected = Object.entries(catalog).filter(([, row]) => row.lifecycle === 'active' && row.installByDefault).map(([name]) => `./skills/${name}`);
  assert.deepStrictEqual(plugin.skills, expected, 'Claude marketplace must expose only active/default skills from the catalog');
  for (const name of ['sc-resend', 'sc-stripe', 'sc-clerk', 'sc-supabase', 'use-si-coder']) {
    assert.ok(!plugin.skills.includes(`./skills/${name}`), `${name} must not be a default installed capability`);
  }
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
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(plugin.version, pkg.version);
  assert.ok(pkg.files.includes('dist/'));
  assert.ok(pkg.files.includes('AI_INSTALL.md'));
  assert.ok(pkg.files.includes('.agents/'));
  assert.ok(pkg.files.includes('machine/'));
  assert.ok(!pkg.files.includes('.mso/'));
  assert.ok(pkg.files.includes('plugins/'));
  assert.ok(pkg.files.includes('SECURITY.md'));
  assert.strictEqual(pkg.engines.node, '^22.0.0 || ^24.0.0 || ^26.0.0');
  assert.strictEqual(pkg.scripts['package:skills'], 'python3 scripts/package-web-skill.py');
  assert.strictEqual(pkg.scripts['catalog:check'], 'node scripts/check-skill-catalog.js');
  assert.ok(!pkg.scripts.preversion, 'npm version must not be an alternate release gate');
  assert.ok(!pkg.scripts.postversion, 'npm version must never auto-push main/tags');
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'release CI must have a lockfile for npm ci');
  assert.strictEqual(pkg.bin['si-coder-onboard'], 'bin/onboard.js');
  const onboard = fs.readFileSync(path.join(ROOT, 'bin/onboard.js'), 'utf8');
  assert.match(onboard, /sc\.js/);
  assert.match(onboard, /\['setup'\]/);
  assert.doesNotMatch(onboard, /appendExportToShellRc|writeFileSync|appendFileSync/, 'default onboard binary must never own credential persistence itself');
  assert.ok(fs.existsSync(path.join(ROOT, 'bin/onboard-legacy.js')), 'legacy shell wizard remains explicit compatibility only');
});


test('DIST-6: OpenAI repository marketplace exposes a web-compatible skill-only plugin', () => {
  const market = readJson('.agents/plugins/marketplace.json');
  const row = market.plugins.find(x => x.name === 'si-coder');
  assert.ok(row);
  assert.deepStrictEqual(row.source, { source: 'local', path: './plugins/si-coder' });
  const plugin = readJson('plugins/si-coder/.codex-plugin/plugin.json');
  assert.strictEqual(plugin.name, 'si-coder');
  assert.strictEqual(plugin.version, readJson('package.json').version);
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
    'docs/install/chatgpt-skills.md',
    'docs/install/chatgpt-workspace-marketplace.md',
    'docs/install/generic-local.md',
    'docs/install/first-run-onboarding.md',
    'docs/publishing/openai-plugin-directory.md',
    'OPENAI_SUBMISSION.md',
  ];
  for (const rel of files) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);

  const claudeCode = fs.readFileSync(path.join(ROOT, 'docs/install/claude-code.md'), 'utf8');
  assert.match(claudeCode, /\/sc Build/);

  const uploadedSkill = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-skills.md'), 'utf8');
  assert.match(uploadedSkill, /@sc/);
  assert.match(uploadedSkill, /Business[\s\S]*Enterprise[\s\S]*Healthcare[\s\S]*Edu/i);
  assert.doesNotMatch(uploadedSkill, /After installation, use:\s*`?\/sc\b/i);

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

test('DIST-9: ChatGPT uploaded skill identity is sc and .skill never promises slash registration', () => {
  const meta = fs.readFileSync(path.join(ROOT, 'skills/sc/agents/openai.yaml'), 'utf8');
  const skill = fs.readFileSync(path.join(ROOT, 'skills/sc/SKILL.md'), 'utf8');
  const chatgpt = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-skills.md'), 'utf8');
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


test('DIST-8b: packaged skill bytes are independent from source group-write permissions', () => {
  const script = path.join(ROOT, 'scripts/package-web-skill.py');
  const py = [
    'import importlib.util, os, pathlib, sys, tempfile',
    'spec=importlib.util.spec_from_file_location(\"pkg\", sys.argv[1])',
    'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'with tempfile.TemporaryDirectory() as td:',
    '  root=pathlib.Path(td)',
    '  a=root/\"a\"/\"skill\"; b=root/\"b\"/\"skill\"',
    '  a.mkdir(parents=True); b.mkdir(parents=True)',
    '  (a/\"SKILL.md\").write_text(\"---\\nname: fixture\\n---\\n\")',
    '  (b/\"SKILL.md\").write_text(\"---\\nname: fixture\\n---\\n\")',
    '  os.chmod(a/\"SKILL.md\", 0o644); os.chmod(b/\"SKILL.md\", 0o664)',
    '  oa=root/\"a.skill\"; ob=root/\"b.skill\"',
    '  m.package(a, oa); m.package(b, ob)',
    '  assert oa.read_bytes()==ob.read_bytes(), \"source permission drift changed archive bytes\"',
  ].join('\n');
  execFileSync('python3', ['-c', py, script], { cwd: ROOT, stdio: 'pipe' });
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

  const chatgpt = fs.readFileSync(path.join(ROOT, 'docs/install/chatgpt-skills.md'), 'utf8');
  assert.match(chatgpt, new RegExp(`releases/download/v${version}/sc\\.zip`));
  assert.match(chatgpt, /does \*\*not\*\* specify that a `\.skill` filename is required/i);
  assert.match(chatgpt, /optional.*sc\.skill/i);
  assert.match(chatgpt, /Business[\s\S]*Enterprise[\s\S]*Healthcare[\s\S]*Edu/i);

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
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run verify:release/);
  assert.match(workflow, /node:\s*\[24, 26\]/);
  assert.match(workflow, /npm run package:skills/);
  assert.match(workflow, /git diff --exit-code -- dist plugins\/si-coder/);
  assert.match(workflow, /cmp --silent dist\/sc\.zip dist\/sc\.skill/);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v\d/, 'GitHub Actions must be pinned to immutable SHAs');

  const releaseWorkflow = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.match(releaseWorkflow, /tags:/);
  assert.match(releaseWorkflow, /workflow_dispatch:/);
  assert.match(releaseWorkflow, /permissions:[\s\S]*contents: write/);
  assert.match(releaseWorkflow, /npm ci --ignore-scripts/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor.*origin\/main/);
  assert.match(releaseWorkflow, /npm run verify:release/);
  assert.match(releaseWorkflow, /npm run package:skills/);
  assert.match(releaseWorkflow, /raw\.githubusercontent\.com/);
  assert.match(releaseWorkflow, /gh release (?:create|upload)/);
  assert.match(releaseWorkflow, /npm publish --access public --provenance/);
  assert.match(releaseWorkflow, /id-token: write/);
  assert.match(releaseWorkflow, /attestations: write/);
  assert.match(releaseWorkflow, /actions\/attest@[0-9a-f]{40}/, 'release artifacts should have pinned provenance attestation');
  assert.match(releaseWorkflow, /releases\/download\/\$\{RELEASE_TAG\}\/sc\.zip/, 'release health must verify the actual downloadable asset');
  const npmStep = releaseWorkflow.indexOf('- name: Publish npm fallback when NPM_TOKEN is configured');
  const publicSourceStep = releaseWorkflow.indexOf('- name: Verify public repository and tagged source are reachable');
  const githubReleaseStep = releaseWorkflow.indexOf('- name: Publish or repair GitHub Release');
  const attestStep = releaseWorkflow.indexOf('- name: Attest release artifacts');
  const publicAssetStep = releaseWorkflow.indexOf('- name: Verify published GitHub release asset is reachable');
  assert.ok(npmStep >= 0 && publicSourceStep > npmStep, 'npm fallback must not be blocked by an external GitHub visibility failure');
  assert.ok(githubReleaseStep > publicSourceStep, 'GitHub Release must not be created until repo + tagged source are public');
  assert.ok(attestStep > githubReleaseStep, 'artifact attestation belongs to the verified GitHub release path');
  assert.ok(publicAssetStep > attestStep, 'downloadable release-asset reachability must be the final publication assertion');
  assert.match(releaseWorkflow, /dist\/sc\.zip/);
  assert.match(releaseWorkflow, /dist\/sc\.skill/);
  assert.doesNotMatch(releaseWorkflow, /actions\/(?:checkout|setup-node|attest)@v\d/, 'release Actions must be pinned to immutable SHAs');
});
