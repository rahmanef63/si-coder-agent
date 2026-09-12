'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const Flow = require('../lib/flow');
const { interpolate } = require('../lib/flow/template');
const { validateFlow, loadFlow, listFlows } = require('../lib/flow/load');
const { runFlow } = require('../lib/flow/runner');

test('flow validate accepts provider-health and rejects bad docs', () => {
  const good = loadFlow('provider-health', { root: ROOT });
  assert.equal(good.id, 'provider-health');
  assert.equal(good.steps.length, 2);
  validateFlow(good);

  assert.throws(() => validateFlow({ id: 'x', steps: [] }), /non-empty/);
  assert.throws(() => validateFlow({
    id: 'bad-uses',
    steps: [{ id: 'a', uses: 'shell' }],
  }), /allowlisted/);
  assert.throws(() => validateFlow({
    id: 'dup',
    steps: [
      { id: 'a', uses: 'sc.fn', with: { name: 'version' } },
      { id: 'a', uses: 'sc.fn', with: { name: 'version' } },
    ],
  }), /duplicate/);
  assert.throws(() => validateFlow({
    id: 'cycle',
    steps: [
      { id: 'a', uses: 'sc.fn', needs: ['b'], with: { name: 'version' } },
      { id: 'b', uses: 'sc.fn', needs: ['a'], with: { name: 'version' } },
    ],
  }), /cycle/);
});

test('template interpolates dotted paths and preserves object/array whole-string values', () => {
  const ctx = {
    props: { providers: ['github', 'dokploy'], name: 'rahman' },
    steps: {
      version: { ok: true, output: { version: '0.9.0', nested: { x: 1 } } },
    },
  };
  assert.equal(interpolate('hi {{props.name}}', ctx), 'hi rahman');
  assert.deepEqual(interpolate('{{props.providers}}', ctx), ['github', 'dokploy']);
  assert.equal(interpolate('{{steps.version.ok}}', ctx), true);
  assert.deepEqual(interpolate({ providers: '{{props.providers}}' }, ctx), { providers: ['github', 'dokploy'] });
  assert.equal(interpolate('{{props.missing?}}', ctx), undefined);
  assert.throws(() => interpolate('{{props.missing}}', ctx), /not found/);
  assert.equal(interpolate('{{steps.version.output.nested.x}}', ctx), 1);
});

test('listFlows discovers packaged provider-health', () => {
  const rows = listFlows({ root: ROOT });
  assert.ok(rows.some(r => r.id === 'provider-health'));
});

test('dry-run provider-health returns structured parallel step results', async () => {
  const doc = loadFlow('provider-health', { root: ROOT });
  const out = await runFlow(doc, {
    props: {},
    dryRun: true,
    parallel: 4,
    root: ROOT,
  });
  assert.equal(out.id, 'provider-health');
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.props.providers, ['github', 'dokploy']);
  assert.equal(out.steps.version.ok, true);
  assert.equal(out.steps.doctor.ok, true);
  assert.equal(out.steps.version.output.uses, 'sc.fn');
  assert.equal(out.steps.doctor.output.name, 'doctor');
  assert.deepEqual(out.steps.doctor.output.input.providers, ['github', 'dokploy']);
});

test('DAG independent steps both complete under parallel dry-run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-flow-'));
  const file = path.join(dir, 'parallel.json');
  fs.writeFileSync(file, JSON.stringify({
    id: 'parallel-demo',
    steps: [
      { id: 'a', uses: 'sc.fn', with: { name: 'version' } },
      { id: 'b', uses: 'sc.fn', with: { name: 'version' } },
    ],
  }));
  const doc = loadFlow(file, { root: ROOT });
  const out = await runFlow(doc, { dryRun: true, parallel: 2, root: ROOT });
  assert.equal(out.ok, true);
  assert.ok(out.steps.a.ok && out.steps.b.ok);
});

test('recursive maxDepth refuses deeper nesting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-flow-nest-'));
  const file = path.join(dir, 'nest.json');
  fs.writeFileSync(file, JSON.stringify({
    id: 'nest',
    steps: [
      {
        id: 'child',
        uses: 'flow',
        with: { flow: file, props: {} },
      },
    ],
  }));
  const doc = loadFlow(file, { root: ROOT });
  const nested = await runFlow(doc, { dryRun: false, root: ROOT, maxDepth: 2, depth: 0 });
  assert.equal(nested.ok, false);
  assert.match(String(nested.steps.child?.error || nested.error || ''), /maxDepth/);
  await assert.rejects(
    () => runFlow(doc, { dryRun: true, root: ROOT, maxDepth: 1, depth: 2 }),
    /maxDepth/,
  );
});

test('Flow index re-exports', () => {
  assert.equal(typeof Flow.listFlows, 'function');
  assert.equal(typeof Flow.loadFlow, 'function');
  assert.equal(typeof Flow.validateFlow, 'function');
  assert.equal(typeof Flow.runFlow, 'function');
});
