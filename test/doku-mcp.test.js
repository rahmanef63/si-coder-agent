const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SC = path.join(ROOT, 'bin/sc.js');
const AGENT = path.join(ROOT, 'scripts/sc-agent.js');
const D = require('../lib/doku-mcp');
const { PROVIDERS } = require('../lib/providers');
const C = require('../lib/connections');

function headers(values = {}) {
  const map = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { get(name) { return map.get(String(name).toLowerCase()) || null; } };
}
function response(body, { status = 200, headers: h = { 'content-type': 'application/json' } } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: headers(h), async text() { return body; } };
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-doku-')); }
function run(args, { env = process.env, input = '' } = {}) {
  return spawnSync(process.execPath, [SC, ...args], { cwd: ROOT, env, input, encoding: 'utf8', timeout: 20000 });
}

test('DOKU-1: provider exposes separate Checkout REST and MCP credential contracts', () => {
  const provider = PROVIDERS.find(row => row.id === 'doku');
  assert.ok(provider);
  assert.strictEqual(provider.status, 'implemented');
  assert.deepStrictEqual(provider.auth.map(row => row.id), ['checkout-rest', 'mcp-api-key']);
  assert.deepStrictEqual(C.authOptions(provider, 'sc').map(row => row.id), ['checkout-rest', 'mcp-api-key']);
  const vars = Object.fromEntries(provider.vars.map(v => [v.key, v]));
  assert.strictEqual(vars.DOKU_CLIENT_ID.secret, true);
  assert.strictEqual(vars.DOKU_SECRET_KEY.secret, true);
  assert.strictEqual(vars.DOKU_MCP_API_KEY.secret, true);
  assert.strictEqual(vars.DOKU_CLIENT_ID.validate('BRN-0259-1678068334526'), true);
  assert.strictEqual(vars.DOKU_CLIENT_ID.validate('MCH-0001-10791114622547'), true);
  assert.strictEqual(vars.DOKU_SECRET_KEY.validate('SK-1234567890abcdef'), true);
  assert.strictEqual(vars.DOKU_MCP_API_KEY.validate('api_key_abcdefgh123456'), true);
  assert.strictEqual(vars.DOKU_CLIENT_ID.validate('BRN invalid'), false);
  assert.strictEqual(vars.DOKU_SECRET_KEY.validate('secret with spaces'), false);
  assert.strictEqual(vars.DOKU_MCP_ENV.secret, false);
  assert.strictEqual(vars.DOKU_MCP_ENV.validate('sandbox'), true);
  assert.strictEqual(vars.DOKU_MCP_ENV.validate('production'), true);
  assert.strictEqual(vars.DOKU_MCP_ENV.validate('live'), false);
});

test('DOKU-2: MCP auth derives Basic apiKey-colon in memory and defaults to sandbox', () => {
  const auth = D.authHeaders({ DOKU_CLIENT_ID: 'merchant-123', DOKU_MCP_API_KEY: 'private-api-key' });
  assert.strictEqual(auth.endpoint, D.ENDPOINTS.sandbox);
  assert.strictEqual(auth.environment, 'sandbox');
  assert.strictEqual(auth.headers['Client-Id'], 'merchant-123');
  assert.strictEqual(auth.headers.Authorization, `Basic ${Buffer.from('private-api-key:').toString('base64')}`);
  assert.throws(() => D.environment('live'), /sandbox or production/);
});

test('DOKU-3: MCP tools discovery initializes Streamable HTTP and propagates session id', async () => {
  const requests = [];
  const queue = [
    response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: D.PROTOCOL_VERSION, capabilities: {}, serverInfo: { name: 'doku' } } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-abc' } }),
    response('', { status: 202, headers: { 'content-type': 'text/plain' } }),
    response(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'create_payment', description: 'test' }] } })),
  ];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); return queue.shift(); };
  const out = await D.tools({ DOKU_CLIENT_ID: 'merchant-123', DOKU_MCP_API_KEY: 'private-api-key', DOKU_MCP_ENV: 'sandbox' }, { fetchImpl });
  assert.deepStrictEqual(out.result.tools.map(t => t.name), ['create_payment']);
  assert.strictEqual(requests.length, 3);
  assert.strictEqual(requests[0].url, D.ENDPOINTS.sandbox);
  assert.strictEqual(JSON.parse(requests[0].init.body).method, 'initialize');
  assert.strictEqual(JSON.parse(requests[1].init.body).method, 'notifications/initialized');
  assert.strictEqual(requests[1].init.headers['Mcp-Session-Id'], 'session-abc');
  assert.strictEqual(JSON.parse(requests[2].init.body).method, 'tools/list');
  assert.strictEqual(requests[2].init.headers['Mcp-Session-Id'], 'session-abc');
});

test('DOKU-4: MCP parser accepts text/event-stream tool result', async () => {
  const queue = [
    response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: D.PROTOCOL_VERSION, capabilities: {} } }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } }),
    response('', { status: 202, headers: { 'content-type': 'text/plain' } }),
    response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
  ];
  const fetchImpl = async () => queue.shift();
  const out = await D.call({ DOKU_CLIENT_ID: 'merchant-123', DOKU_MCP_API_KEY: 'private-api-key', DOKU_MCP_ENV: 'production' }, 'transaction_status', { invoice: 'INV1' }, { fetchImpl });
  assert.strictEqual(out.environment, 'production');
  assert.strictEqual(out.result.content[0].text, 'ok');
});

test('DOKU-5: machine manifest exposes only secret-safe DOKU functions and confirms calls', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'machine/functions.json'), 'utf8'));
  const tools = manifest.functions.find(fn => fn.name === 'sc.doku.mcp.tools');
  const call = manifest.functions.find(fn => fn.name === 'sc.doku.mcp.call');
  assert.ok(tools);
  assert.ok(call);
  assert.deepStrictEqual(Object.keys(tools.inputSchema.properties).sort(), ['connection', 'user']);
  assert.strictEqual(call.inputSchema.properties.confirm.const, true);
  assert.deepStrictEqual(Object.keys(call.inputSchema.properties).sort(), ['arguments', 'confirm', 'connection', 'tool', 'user']);
  assert.doesNotMatch(JSON.stringify({ tools, call }), /DOKU_(?:SECRET_KEY|MCP_API_KEY)|Authorization/i);
});

test('DOKU-6: human CLI requires explicit confirmation before a remote MCP call', () => {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  let r = run(['user', 'add', 'agent'], { env });
  assert.strictEqual(r.status, 0, r.stderr);
  r = run(['user', 'connection-add', 'agent', 'doku', 'Sandbox MCP', '--source', 'sc', '--auth', 'mcp-api-key'], { env });
  assert.strictEqual(r.status, 0, r.stderr);
  const connection = C.slugify('Sandbox MCP');
  r = run(['doku', 'mcp', 'call', 'create_payment', '--user', 'agent', '--connection', connection], { env });
  assert.notStrictEqual(r.status, 0);
  assert.match(`${r.stdout}\n${r.stderr}`, /require --confirm/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('DOKU-7: machine adapter refuses DOKU MCP call without confirm before reading credentials', () => {
  const r = spawnSync(process.execPath, [AGENT, 'doku.mcp.call'], {
    cwd: ROOT, input: JSON.stringify({ user: 'agent', connection: 'sandbox', tool: 'create_payment' }), encoding: 'utf8', timeout: 10000,
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(`${r.stdout}\n${r.stderr}`, /confirm=true is required/i);
});
