const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { productInterview } = require('../lib/product-interview');

const ROOT = path.resolve(__dirname, '..');

test('SCINT-1: vague product idea asks exactly one product question', () => {
  const p = productInterview({ goal: 'laundry website', questionsAsked: 0 });
  assert.strictEqual(p.readyToBuild, false);
  assert.ok(p.nextQuestion);
  assert.strictEqual(p.userFlow.status, 'needs-answer');
  assert.doesNotMatch(JSON.stringify(p.userFlow), /vercel|dokploy|convex|dns|database|framework|container|api key/i);
});

test('SCINT-2: complete product intent starts building without another interview', () => {
  const p = productInterview({
    goal: 'Salon booking app',
    primaryUser: 'Customers and salon staff',
    primaryAction: 'Customers request a booking slot',
    mustHave: 'Staff can confirm or decline requests',
    questionsAsked: 0,
  });
  assert.strictEqual(p.readyToBuild, true);
  assert.strictEqual(p.nextQuestion, null);
  assert.match(p.userFlow.next, /build/i);
});

test('SCINT-3: discovery hard-stops after three questions and uses assumptions', () => {
  const p = productInterview({ goal: 'Laundry app', questionsAsked: 3 });
  assert.strictEqual(p.readyToBuild, true);
  assert.strictEqual(p.nextQuestion, null);
  assert.strictEqual(p.policy.maxQuestionsBeforeFirstBuild, 3);
  assert.ok(p.assumptions.length >= 1);
});

test('SCINT-4: existing project skips discovery', () => {
  const p = productInterview({ existingProject: true, goal: 'Existing app' });
  assert.strictEqual(p.readyToBuild, true);
  assert.strictEqual(p.nextQuestion, null);
  assert.match(p.userFlow.message, /existing app/i);
});

test('SCINT-5: MSO manifest exposes the product interview without secret-shaped inputs', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.mso/functions.json'), 'utf8'));
  const fn = manifest.functions.find(x => x.name === 'sc.product.interview');
  assert.ok(fn);
  assert.strictEqual(fn.command.at(-1), 'product.interview');
  assert.doesNotMatch(JSON.stringify(fn.inputSchema), /password|apiKey|token|secretValue|value/i);
});

test('SCINT-6: machine adapter returns userFlow as the default presentation', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-agent.js'), 'product.interview'], {
    cwd: ROOT,
    input: JSON.stringify({ goal: 'laundry website', questionsAsked: 0 }),
    encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.presentation.defaultField, 'userFlow');
  assert.strictEqual(out.userFlow.status, 'needs-answer');
});

test('SCINT-7: slash skills exist as standard SKILL.md Agent Skills', () => {
  for (const name of ['sc', 'sc-build']) {
    const file = path.join(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(fs.existsSync(file), `${file} missing`);
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, new RegExp(`name:\\s*${name}\\b`));
  }
  const nonstandard = fs.readdirSync(path.join(ROOT, 'skills'), { recursive: true }).filter(x => String(x).endsWith('.skill'));
  assert.deepStrictEqual(nonstandard, [], 'portable Agent Skills should use SKILL.md, not a nonstandard .skill file');
});
