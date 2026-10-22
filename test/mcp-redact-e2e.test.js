'use strict';
// End-to-end: spawn sc-mcp.js over stdio with a fake secret in env and a tool that echoes it.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SECRET_NAME } = require('../lib/redact-env');

const ROOT = path.resolve(__dirname, '..');
const FAKE = 'dummyvalue123456';

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mcp-e2e-'));
  for (const d of ['scripts', 'lib', 'machine']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(path.join(ROOT, 'scripts/sc-mcp.js'), path.join(dir, 'scripts/sc-mcp.js'));
  for (const f of ['redact-env.js', 'mcp-contract.js']) fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(dir, 'lib', f));
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(dir, 'package.json'));
  fs.writeFileSync(path.join(dir, 'scripts/echo.js'),
    "process.stdout.write(JSON.stringify({ token: process.env.FAKE_TEST_TOKEN, author: process.env.GIT_AUTHOR_NAME, msg: 'tok=' + process.env.FAKE_TEST_TOKEN }));");
  fs.writeFileSync(path.join(dir, 'machine/functions.json'), JSON.stringify({ version: 1, functions: [{
    name: 'test.echo', description: 'echo env', inputSchema: { type: 'object' }, command: ['node', 'scripts/echo.js'],
  }] }));
  return dir;
}

test('MCP-E2E-1: tools/call output redacts secret env value end-to-end', () => {
  const dir = sandbox();
  try {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'test.echo', arguments: {} } },
    ].map(m => JSON.stringify(m)).join('\n') + '\n';
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts/sc-mcp.js')], {
      input, encoding: 'utf8', timeout: 120000, cwd: dir,
      env: { ...process.env, FAKE_TEST_TOKEN: FAKE, GIT_AUTHOR_NAME: 'si-coder-author' },
    });
    const out = r.stdout;
    assert.ok(out.trim(), `no MCP output (signal=${r.signal}, err=${r.error && r.error.code}): ${r.stderr}`);
    assert.ok(!out.includes(FAKE), 'raw fake secret leaked in MCP output');
    const resp = out.trim().split('\n').map(l => JSON.parse(l)).find(m => m.id === 2);
    assert.ok(resp && resp.result, `no tools/call result: ${out} ${r.stderr}`);
    assert.match(resp.result.content[0].text, /\[redacted\]/);
    if (resp.result.structuredContent) assert.strictEqual(resp.result.structuredContent.token, '[redacted]');
    assert.match(resp.result.content[0].text, /si-coder-author/, 'harmless AUTHOR var must not be redacted');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('MCP-E2E-2: AUTH name match is segment-bound (no AUTHOR over-redaction)', () => {
  for (const k of ['AUTH', 'BASIC_AUTH', 'AUTH_HEADER', 'OAUTH_CLIENT', 'GOOGLE_OAUTH']) assert.ok(SECRET_NAME.test(k), k);
  for (const k of ['AUTHOR', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'AUTHORITY', 'NPM_CONFIG_AUTHOR']) assert.ok(!SECRET_NAME.test(k), k);
});
