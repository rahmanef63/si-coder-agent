'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { annotationsFor, validateArgs } = require('../lib/mcp-contract');
const ROOT = path.resolve(__dirname, '..');
const FNS = require('../machine/functions.json').functions;

function rpc(lines) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], { input: lines.map(l => JSON.stringify(l)).join('\n') + '\n', encoding: 'utf8', timeout: 120000 });
  return r.stdout.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

test('CONTRACT-1: registry names unique, sc.* prefixed, object schemas closed', () => {
  const names = FNS.map(f => f.name);
  assert.strictEqual(new Set(names).size, names.length);
  for (const f of FNS) {
    assert.match(f.name, /^sc\.[a-z0-9.-]+$/);
    assert.ok(f.description && f.description.length >= 20, f.name);
    assert.strictEqual(f.inputSchema.type, 'object', f.name);
    assert.strictEqual(f.inputSchema.additionalProperties, false, f.name);
    assert.ok(Array.isArray(f.command) && f.command.length, f.name);
  }
});

test('CONTRACT-2: every tool has boolean hints; never both readOnly and destructive', () => {
  for (const f of FNS) {
    const a = annotationsFor(f);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) assert.strictEqual(typeof a[k], 'boolean', `${f.name}.${k}`);
    assert.ok(!(a.readOnlyHint && a.destructiveHint), f.name);
  }
  const by = n => annotationsFor(FNS.find(f => f.name === n));
  assert.strictEqual(by('sc.user.list').readOnlyHint, true);
  assert.strictEqual(by('sc.user.delete').destructiveHint, true);
  assert.strictEqual(by('sc.provider.delete').destructiveHint, true);
  assert.strictEqual(by('sc.update').readOnlyHint, false);
});

test('CONTRACT-3: validateArgs rejects unknown/missing/wrong-typed args', () => {
  const s = { type: 'object', properties: { a: { type: 'string', maxLength: 3 }, n: { type: 'integer', minimum: 0 } }, required: ['a'], additionalProperties: false };
  assert.deepStrictEqual(validateArgs(s, { a: 'ok' }), []);
  assert.ok(validateArgs(s, {}).some(e => e.includes('missing')));
  assert.ok(validateArgs(s, { a: 'ok', z: 1 }).some(e => e.includes('unknown')));
  assert.ok(validateArgs(s, { a: 'toolong' }).some(e => e.includes('maxLength')));
  assert.ok(validateArgs(s, { a: 'x', n: -1 }).some(e => e.includes('minimum')));
  assert.ok(validateArgs(s, { a: 1 }).length);
});

test('CONTRACT-4: stdio server exposes annotations and rejects bad args before executing', () => {
  const [list, bad] = rpc([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sc.version', arguments: { bogus: true } } },
  ]);
  assert.ok(list.result.tools.every(t => t.annotations && typeof t.annotations.readOnlyHint === 'boolean'));
  assert.strictEqual(bad.error.code, -32602);
  assert.ok(bad.error.data.problems.some(p => p.includes('bogus')));
});
