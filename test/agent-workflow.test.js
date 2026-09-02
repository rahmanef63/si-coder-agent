'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const Policy = require('../lib/agent/policy');
const Memory = require('../lib/agent/memory-store');
const Evidence = require('../lib/agent/evidence-store');
const Recipes = require('../lib/agent/recipe-store');
const Skills = require('../lib/agent/skill-verifier');
const Actions = require('../lib/agent/actions');

const ROOT = path.resolve(__dirname, '..');
function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-agent-workflow-')); }

function writeSkill(root, body = '# Demo\n') {
  fs.mkdirSync(path.join(root, 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'demo', 'SKILL.md'), `---\nname: "demo"\ndescription: "Demo skill"\nuse_when: "Use for demo tasks"\ndo_not_use_when: "Do not use outside demo tasks"\nrequired_tools: []\nsecurity_constraints: "Never persist plaintext credentials"\nreferences: []\ncompatibility: "standalone"\n---\n\n${body}`);
}

test('AGENT-1: risk classifier requires isolation for credential/auth/MCP changes', () => {
  const high = Policy.classifyTask({ intent: 'change credential auth and MCP tool schema' });
  assert.equal(high.risk, 'HIGH');
  assert.equal(high.isolationRequired, true);
  const medium = Policy.classifyTask({ intent: 'add one CLI feature' });
  assert.equal(medium.risk, 'MEDIUM');
  const low = Policy.classifyTask({ intent: 'fix README typo' });
  assert.equal(low.risk, 'LOW');
});

test('AGENT-2: memory foundation creates portable canonical directories', () => {
  const root = tempRoot();
  const out = Memory.ensureFoundation(root);
  assert.equal(out.agentDir, path.join(root, '.agent'));
  for (const rel of Memory.FOUNDATION_DIRS) assert.equal(fs.statSync(path.join(root, rel)).isDirectory(), true);
});

test('AGENT-3: test memory stores required verification fields and query returns compact relevant context', () => {
  const root = tempRoot();
  Memory.writeMemory('test', {
    id: 'test-github-auth', title: 'GitHub auth regression', target: 'GitHub connection', source: 'manual CLI', environment: 'local',
    steps: ['select direct connection', 'run verify'], expected: 'direct connection selected', actual: 'direct connection selected', result: 'pass',
    relatedAreas: ['github', 'auth'], tags: ['github'], body: 'Verified direct routing without external fallback.', lastVerified: '2026-09-02T00:00:00Z',
  }, { root, now: '2026-09-02T00:00:00Z' });
  Memory.writeMemory('decision', {
    id: 'decision-unrelated', title: 'UI wording decision', decision: 'Keep concise labels', body: 'Unrelated user interface copy.', tags: ['ui'],
  }, { root, now: '2026-09-01T00:00:00Z' });
  const out = Memory.queryMemory({ query: 'github auth', limit: 1 }, { root });
  assert.equal(out.count, 1);
  assert.equal(out.memories[0].id, 'test-github-auth');
  assert.match(out.context, /GitHub auth regression/);
  assert.doesNotMatch(out.context, /UI wording/);
});

test('AGENT-3b: stale memory is marked and down-ranked instead of silently treated as current fact', () => {
  const root = tempRoot();
  Memory.writeMemory('debug', {
    id: 'debug-old-provider', title: 'Provider auth behavior', issue: 'old behavior', body: 'Provider behavior from an old verification.',
    status: 'confirmed', lastVerified: '2025-01-01T00:00:00Z', tags: ['provider'],
  }, { root, now: '2025-01-01T00:00:00Z' });
  const out = Memory.queryMemory({ query: 'provider auth', staleAfterDays: 30 }, { root, now: '2026-09-02T00:00:00Z' });
  assert.equal(out.memories[0].stale, true);
  assert.match(out.context, /STALE/);
  const freshOnly = Memory.queryMemory({ query: 'provider auth', staleAfterDays: 30, freshOnly: true }, { root, now: '2026-09-02T00:00:00Z' });
  assert.equal(freshOnly.count, 0);
});

test('AGENT-3c: task.prepare skips memory for light work and retrieves compact context for heavy work', () => {
  const root = tempRoot();
  Memory.writeMemory('decision', { id: 'decision-auth-route', title: 'Auth route policy', decision: 'Keep source selection explicit', body: 'Auth routing must preserve explicit source selection.', tags: ['auth'] }, { root });
  const light = Actions.taskPrepareAction({ intent: 'fix README typo' }, { root });
  assert.equal(light.policy.risk, 'LOW');
  assert.equal(light.retrieval.used, false);
  const heavy = Actions.taskPrepareAction({ intent: 'change auth provider routing', tags: ['auth'] }, { root });
  assert.equal(heavy.policy.risk, 'HIGH');
  assert.equal(heavy.retrieval.used, true);
  assert.ok(heavy.retrieval.count >= 1);
  assert.match(heavy.retrieval.context, /Auth route policy/);
});

test('AGENT-4: memory lifecycle supports confirmed/superseded/archived without deletion', () => {
  const root = tempRoot();
  Memory.writeMemory('debug', { id: 'debug-routing', title: 'Routing bug', issue: 'wrong route', body: 'No raw credentials.' }, { root });
  Memory.setMemoryStatus('debug-routing', 'confirmed', { root, lastVerified: '2026-09-02T00:00:00Z' });
  assert.equal(Memory.listMemory({ root, includeArchived: true }).find(x => x.id === 'debug-routing').status, 'confirmed');
  Memory.setMemoryStatus('debug-routing', 'archived', { root });
  assert.equal(Memory.listMemory({ root }).some(x => x.id === 'debug-routing'), false);
  assert.equal(Memory.listMemory({ root, includeArchived: true }).some(x => x.id === 'debug-routing'), true);
});

test('AGENT-5: memory and evidence refuse secret-shaped content before persistence', () => {
  const root = tempRoot();
  const fake = `ghp_${'A'.repeat(32)}`;
  assert.throws(() => Memory.writeMemory('debug', { title: 'bad', body: `leaked ${fake}` }, { root }), /secret-shaped content/);
  assert.throws(() => Evidence.writeEvidence({ target: 'bad receipt', assertions: { note: `Bearer ${'B'.repeat(30)}` } }, { root }), /secret-shaped content/);
  assert.equal(fs.readdirSync(path.join(root, '.agent', 'memory', 'debug')).length, 0);
  assert.equal(fs.readdirSync(path.join(root, '.agent', 'evidence')).length, 0);
});

test('AGENT-6: evidence receipt persists structured verification without raw logs', () => {
  const root = tempRoot();
  const out = Evidence.writeEvidence({
    id: 'evidence-demo', target: 'connection migration', commit: 'abc123', risk: 'HIGH', command: 'sc verify', exitCode: 0,
    assertions: { metadataVersion: 2, secretExposure: false }, checks: { tests: 'passed', docs: 'passed' }, secretRedaction: true,
  }, { root, generatedAt: '2026-09-02T00:00:00Z' });
  const receipt = JSON.parse(fs.readFileSync(out.path, 'utf8'));
  assert.equal(receipt.assertions.metadataVersion, 2);
  assert.equal(receipt.assertions.secretExposure, false);
  assert.equal(receipt.secret_redaction, true);
});

test('AGENT-7: recipe observation promotes observed -> repeated -> candidate -> verified -> executable', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'scripts', 'demo.js'), 'console.log(JSON.stringify({ok:true}))\n');
  assert.equal(Recipes.observeRecipe('release candidate check', { steps: ['test', 'docs'] }, { root }).status, 'observed');
  assert.equal(Recipes.observeRecipe('release candidate check', { steps: ['test', 'docs'] }, { root }).status, 'repeated');
  assert.equal(Recipes.observeRecipe('release candidate check', { steps: ['test', 'docs'] }, { root }).status, 'candidate');
  assert.equal(Recipes.verifyRecipe('release-candidate-check', { root }).status, 'verified');
  const promoted = Recipes.promoteRecipe('release-candidate-check', 'scripts/demo.js', { root });
  assert.equal(promoted.status, 'executable');
  assert.equal(promoted.script, 'scripts/demo.js');
  assert.throws(() => Recipes.promoteRecipe('release-candidate-check', '../escape.js', { root }), /inside the repository|does not exist/);
});

test('AGENT-8: strict skill verifier validates explicit trigger/security/compatibility contract', () => {
  const root = tempRoot();
  writeSkill(root);
  const out = Skills.verifySkills({ root, strict: true });
  assert.equal(out.ok, true);
  assert.equal(out.errorCount, 0);
  assert.equal(out.skillCount, 1);
});

test('AGENT-9: strict skill verifier rejects missing trigger contract and secret material', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'skills', 'bad'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', 'bad', 'SKILL.md'), `---\nname: "bad"\ndescription: "Bad skill"\n---\n\nBearer ${'C'.repeat(30)}\n`);
  const out = Skills.verifySkills({ root, strict: true });
  assert.equal(out.ok, false);
  assert.ok(out.skills[0].errors.some(x => x.includes('trigger contract')));
  assert.ok(out.skills[0].errors.some(x => x.includes('secret-shaped content')));
});

test('AGENT-10: CLI exposes bounded risk/memory/recipe/skill/verify surfaces', () => {
  const help = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sc.js'), 'help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  for (const phrase of ['sc risk', 'sc task prepare', 'sc memory init', 'sc recipe observe', 'sc skill verify', 'sc verify']) assert.match(help.stdout, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const risk = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'sc.js'), 'risk', 'credential auth change', '--json'], { encoding: 'utf8' });
  assert.equal(risk.status, 0);
  assert.equal(JSON.parse(risk.stdout).risk, 'HIGH');
});

test('AGENT-11: machine manifest exposes standalone memory/evidence/recipe/skill functions and routes verify through the safe adapter', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'machine', 'functions.json'), 'utf8'));
  const map = new Map(manifest.functions.map(x => [x.name, x]));
  for (const name of ['sc.task.risk', 'sc.task.prepare', 'sc.memory.query', 'sc.memory.record', 'sc.memory.status', 'sc.evidence.record', 'sc.skill.verify', 'sc.recipe.list', 'sc.recipe.observe', 'sc.recipe.verify', 'sc.recipe.promote', 'sc.verify']) assert.ok(map.has(name), name);
  assert.deepEqual(map.get('sc.verify').command, ['node', 'scripts/sc-agent.js', 'verify']);
  const recordSchema = map.get('sc.memory.record').inputSchema;
  assert.equal(recordSchema.additionalProperties, false);
  assert.equal(recordSchema.properties.type.type, 'string');
});

test('AGENT-12: repository skill set passes strict trigger contract validation', () => {
  const out = Skills.verifySkills({ root: ROOT, strict: true });
  assert.equal(out.ok, true);
  assert.equal(out.errorCount, 0);
  assert.ok(out.skillCount >= 20);
});
