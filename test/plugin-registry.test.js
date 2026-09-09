'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadManifest, listPlugins, validateManifest, MANIFEST_SCHEMA } = require('../lib/plugin-registry');

const ROOT = path.resolve(__dirname, '..');
const canonicalPath = path.join(ROOT, 'plugins', 'si-coder', 'plugin.json');

function validManifest(overrides = {}) {
  return {
    $schema: MANIFEST_SCHEMA,
    schemaVersion: 1,
    version: '1.2.3',
    id: 'fixture-plugin',
    metadata: { name: 'Fixture Plugin', description: 'Safe test plugin.' },
    ...overrides,
  };
}

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-plugin-'));
  fs.mkdirSync(path.join(base, 'skills', 'fixture'), { recursive: true });
  fs.mkdirSync(path.join(base, 'machine'), { recursive: true });
  fs.mkdirSync(path.join(base, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(base, 'skills', 'fixture', 'SKILL.md'), '# Fixture\n');
  fs.writeFileSync(path.join(base, 'machine', 'functions.json'), '{}\n');
  fs.writeFileSync(path.join(base, 'scripts', 'mcp.js'), 'module.exports = {};\n');
  return base;
}

test('PLUGIN-1: canonical SI-Coder manifest loads and declares skills plus MCP', () => {
  const manifest = loadManifest(canonicalPath);
  assert.equal(manifest.$schema, MANIFEST_SCHEMA);
  assert.equal(manifest.id, 'si-coder');
  assert.ok(manifest.skills?.length);
  assert.ok(manifest.mcp?.length);
  assert.equal(manifest.mcp[0].transport, 'stdio');
});

test('PLUGIN-2: registry discovery is metadata-only and never returns execution/config fields', () => {
  const rows = listPlugins();
  const sc = rows.find(row => row.id === 'si-coder');
  assert.ok(sc);
  assert.deepEqual(Object.keys(sc).sort(), ['$schema', 'id', 'metadata', 'schemaVersion', 'version'].sort());
  const serialized = JSON.stringify(rows);
  assert.doesNotMatch(serialized, /(?:entrypoint|catalog|endpoint|credential|secret|token|password|authorization|env)/i);
});

test('PLUGIN-3: rejects unsupported versions, unknown keys, and secret/command-shaped fields', () => {
  assert.throws(() => validateManifest(validManifest({ schemaVersion: 2 })), /unsupported schemaVersion/);
  assert.throws(() => validateManifest(validManifest({ version: 'latest' })), /version/);
  assert.throws(() => validateManifest({ ...validManifest(), extra: true }), /unknown key extra/);
  assert.throws(() => validateManifest({ ...validManifest(), apiToken: 'nope' }), /sensitive or command-like key/i);
  assert.throws(() => validateManifest({ ...validManifest(), command: 'echo nope' }), /sensitive or command-like key/i);
  assert.throws(() => validateManifest({ ...validManifest(), metadata: { name: 'X', description: 'Y', authorizationHeader: 'nope' } }), /sensitive or command-like key/i);
});

test('PLUGIN-4: validates contained local targets and rejects traversal, absolute paths, and missing files', () => {
  const base = fixture();
  try {
    const good = validManifest({
      skills: [{ id: 'fixture', path: 'skills/fixture/SKILL.md' }],
      mcp: [{ transport: 'stdio', entrypoint: 'scripts/mcp.js', catalog: 'machine/functions.json' }],
    });
    assert.equal(validateManifest(good, { base }).id, 'fixture-plugin');
    assert.throws(() => validateManifest(validManifest({ skills: [{ id: 'fixture', path: '../outside/SKILL.md' }] }), { base }), /safe relative path|escapes package/);
    assert.throws(() => validateManifest(validManifest({ skills: [{ id: 'fixture', path: path.join(base, 'skills/fixture/SKILL.md') }] }), { base }), /safe relative path/);
    assert.throws(() => validateManifest(validManifest({ skills: [{ id: 'fixture', path: 'skills/missing/SKILL.md' }] }), { base }), /target is missing/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('PLUGIN-5: rejects symlink escapes', { skip: process.platform === 'win32' }, () => {
  const base = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-plugin-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'SKILL.md'), '# Outside\n');
    fs.symlinkSync(outside, path.join(base, 'skills', 'escape'));
    const manifest = validManifest({ skills: [{ id: 'escape', path: 'skills/escape/SKILL.md' }] });
    assert.throws(() => validateManifest(manifest, { base }), /symlink escapes package/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('PLUGIN-6: remote descriptors require plain HTTPS URLs without embedded credentials, query, or fragment', () => {
  const remote = endpoint => validManifest({ mcp: [{ transport: 'https', endpoint }] });
  assert.equal(validateManifest(remote('https://mcp.example.test/v1')).id, 'fixture-plugin');
  assert.throws(() => validateManifest(remote('http://mcp.example.test')), /safe https URL|https URL/);
  assert.throws(() => validateManifest(remote('https://user:pass@mcp.example.test')), /safe https URL/);
  assert.throws(() => validateManifest(remote('https://mcp.example.test?token=nope')), /safe https URL/);
  assert.throws(() => validateManifest(remote('https://mcp.example.test/#secret')), /safe https URL/);
});
