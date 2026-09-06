'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const Meta = require('../lib/skill-metadata');
const Registry = require('../lib/skill-registry');
const Search = require('../lib/skill-search');
const Store = require('../lib/skill-store');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-skill-search-')); }
function runNode(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], { cwd, encoding: 'utf8', env: { ...process.env, SC_SKILLS_ROOT: path.join(cwd, '.global-skills') } });
}

test('SKSEARCH-1: Agent Skills names normalize and nested metadata remains readable', () => {
  assert.equal(Meta.specSkillName('UI Audit.Pro'), 'ui-audit-pro');
  const dir = tmp();
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, `---\nname: ui-audit\ndescription: "Audit UI."\nmetadata:\n  author: "team"\n  sc.tags: "ui, frontend, design-system"\n  sc.aliases: "interface, visual"\n  sc.tags-source: "manual"\n---\n\n# UI\n`);
  const meta = Meta.readFrontmatter(file);
  assert.equal(meta.metadata.author, 'team');
  assert.equal(meta.metadata['sc.tags'], 'ui, frontend, design-system');
  const discovery = Meta.metadataForSkill(file);
  assert.deepEqual(discovery.tags, ['ui', 'frontend', 'design-system']);
  assert.deepEqual(discovery.aliases, ['interface', 'visual']);
  assert.equal(discovery.tagsSource, 'manual');
});

test('SKSEARCH-2: bundled skills are discoverable by intent words without manual tag migration', () => {
  const ui = Registry.resolveSkill('sc-ui');
  assert.ok(ui.tags.includes('ui'));
  assert.ok(ui.aliases.includes('interface'));
  const interfaceMatches = Search.searchSkills('interface', { limit: 10 });
  assert.ok(interfaceMatches.some(row => row.name === 'sc-ui'));
  const accessibilityMatches = Search.searchSkills('accessibility', { limit: 10 });
  assert.ok(accessibilityMatches.some(row => row.name === 'sc-ux'));
  const deployMatches = Search.searchSkills('deploy production', { limit: 15 });
  assert.ok(deployMatches.some(row => ['sc-all', 'sc-dokploy', 'sc-vercel'].includes(row.name)));
});

test('SKSEARCH-3: managed skill creation writes automatic namespaced discovery metadata', () => {
  const projectRoot = tmp();
  const options = { projectRoot, globalRoot: path.join(projectRoot, 'global') };
  const row = Store.createSkill({
    name: 'visual-audit',
    scope: 'project',
    description: 'Audit web UI hierarchy, typography, spacing, responsive layout, and design-system consistency.',
  }, options);
  assert.ok(row.tags.includes('ui'));
  assert.ok(row.tags.includes('frontend'));
  const text = fs.readFileSync(path.join(row.path, 'SKILL.md'), 'utf8');
  assert.match(text, /^metadata:\s*$/m);
  assert.match(text, /^\s+sc\.tags:/m);
  assert.match(text, /^\s+sc\.aliases:/m);
  assert.match(text, /^\s+sc\.tags-source: "auto-v1"/m);
  const results = Search.searchRows(Registry.listSkills(options), 'interface', { limit: 10 });
  assert.ok(results.some(item => item.id === 'project:visual-audit'));
});

test('SKSEARCH-4: --from-dir preserves the Agent Skill bundle and rejects symlinks', () => {
  const projectRoot = tmp();
  const options = { projectRoot, globalRoot: path.join(projectRoot, 'global') };
  const source = path.join(projectRoot, 'source-skill');
  fs.mkdirSync(path.join(source, 'references'), { recursive: true });
  fs.mkdirSync(path.join(source, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), `---\nname: bundle-demo\ndescription: "Inspect API payloads and use the bundled reference when debugging integrations."\n---\n\n# Bundle demo\n`);
  fs.writeFileSync(path.join(source, 'references', 'GUIDE.md'), '# Guide\n');
  fs.writeFileSync(path.join(source, 'scripts', 'inspect.js'), 'console.log("ok")\n');
  const row = Store.createSkill({ name: 'bundle-demo', scope: 'project', fromDir: source }, options);
  assert.ok(fs.existsSync(path.join(row.path, 'references', 'GUIDE.md')));
  assert.ok(fs.existsSync(path.join(row.path, 'scripts', 'inspect.js')));
  assert.ok(row.tags.includes('api'));

  const bad = path.join(projectRoot, 'bad-skill');
  fs.mkdirSync(bad);
  fs.writeFileSync(path.join(bad, 'SKILL.md'), `---\nname: bad-skill\ndescription: "Bad bundle."\n---\n`);
  fs.symlinkSync(path.join(source, 'references', 'GUIDE.md'), path.join(bad, 'linked.md'));
  assert.throws(() => Store.createSkill({ name: 'bad-skill', scope: 'project', fromDir: bad }, options), /symlink/);
  assert.ok(!fs.existsSync(path.join(projectRoot, '.mso', 'skills', 'bad-skill')));
});

test('SKSEARCH-5: sc-skill --new exposes an agent contract and creates a searchable project skill', () => {
  const cwd = tmp();
  const contract = runNode('bin/sc-skill.js', ['--new'], cwd);
  assert.equal(contract.status, 0, contract.stderr);
  const parsed = JSON.parse(contract.stdout);
  assert.equal(parsed.command, 'sc-skill --new');
  assert.ok(parsed.automatic.some(item => item.includes('derive search tags')));

  const create = runNode('bin/sc-skill.js', ['--new', 'UI Helper', '--description', 'Improve UI styling, responsive layouts, and component consistency.', '--json'], cwd);
  assert.equal(create.status, 0, create.stderr);
  const created = JSON.parse(create.stdout);
  assert.equal(created.name, 'ui-helper');
  assert.ok(created.tags.includes('ui'));

  const search = runNode('bin/sc-skill.js', ['interface', '--json'], cwd);
  assert.equal(search.status, 0, search.stderr);
  const result = JSON.parse(search.stdout);
  assert.ok(result.skills.some(row => row.name === 'ui-helper'));
});

test('SKSEARCH-6: sc skills search keeps the cross-host registry JSON envelope', () => {
  const cwd = tmp();
  const result = runNode('bin/sc-entry.js', ['skills', 'ui', '--json'], cwd);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.source, 'si-coder');
  assert.equal(parsed.contract.list, '/skills');
  assert.equal(parsed.query, 'ui');
  assert.ok(parsed.skills.some(row => row.name === 'sc-ui'));
});


test('SKSEARCH-7: shared Finder fuzzy matcher supports multi-token and typo-tolerant discovery', () => {
  const Fuzzy = require('../lib/fuzzy');
  const items = [
    { id: 'ui', searchText: 'ui interface visual frontend design-system accessibility' },
    { id: 'deploy', searchText: 'deployment production hosting dokploy' },
  ];
  const interfaceHit = Fuzzy.rankItems(items, 'interfce', item => item.searchText);
  assert.equal(interfaceHit[0]?.id, 'ui');
  const multi = Fuzzy.rankItems(items, 'visual frontend', item => item.searchText);
  assert.deepEqual(multi.map(item => item.id), ['ui']);
  const finderSource = fs.readFileSync(path.join(ROOT, 'lib', 'finder-tui.js'), 'utf8');
  const scSource = fs.readFileSync(path.join(ROOT, 'bin', 'sc.js'), 'utf8');
  assert.match(finderSource, /Fuzzy\.rankItems/);
  assert.match(finderSource, /it\.searchText/);
  assert.match(scSource, /searchText: \[row\.name, row\.invocation, row\.description/);
});

test('SKSEARCH-8: manual tags survive description edits while auto tags refresh', () => {
  const projectRoot = tmp();
  const options = { projectRoot, globalRoot: path.join(projectRoot, 'global') };
  let row = Store.createSkill({ name: 'manual-meta', description: 'A UI audit helper.', scope: 'project', tags: ['custom-taxonomy'], aliases: ['special-ui'] }, options);
  row = Store.updateSkill(row.id, { description: 'A database audit helper.' }, options);
  assert.deepEqual(row.tags, ['custom-taxonomy']);
  assert.deepEqual(row.aliases, ['special-ui']);

  let auto = Store.createSkill({ name: 'auto-meta', description: 'A UI audit helper.', scope: 'project' }, options);
  assert.ok(auto.tags.includes('ui'));
  auto = Store.updateSkill(auto.id, { description: 'A database schema migration helper.' }, options);
  assert.ok(auto.tags.includes('database'));
  assert.ok(!auto.tags.includes('ui'));
});
