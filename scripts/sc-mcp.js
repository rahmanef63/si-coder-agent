#!/usr/bin/env node
// Dependency-free SI-Coder MCP stdio server.
//
// Hybrid protocol support:
// - 2026-07-28: stateless requests + server/discover + per-request _meta.
// - 2025-11-25: initialize/initialized compatibility for clients that have not migrated.
//
// The tool catalog itself remains machine/functions.json, so transport evolution does not
// create a second function/schema source of truth.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PKG = require('../package.json');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'machine/functions.json'), 'utf8'));
const FUNCTIONS = MANIFEST.functions;
const BY_NAME = new Map(FUNCTIONS.map(f => [f.name, f]));
const MODERN_PROTOCOL = '2026-07-28';
const LEGACY_PROTOCOL = '2025-11-25';
const PROTOCOL_META = 'io.modelcontextprotocol/protocolVersion';
const SERVER_INFO_META = 'io.modelcontextprotocol/serverInfo';

function serverInfo() { return { name: 'si-coder', version: PKG.version }; }
function capabilities() { return { tools: { listChanged: false }, resources: {}, prompts: {} }; }
function requestProtocol(msg) { return msg?.params?._meta?.[PROTOCOL_META] || null; }
function isModern(msg) { return msg?.method === 'server/discover' || requestProtocol(msg) === MODERN_PROTOCOL; }
function modernResult(result, msg) {
  if (!isModern(msg) || !result || typeof result !== 'object' || Array.isArray(result)) return result;
  // MCP 2026-07-28 requires a wire-level result discriminator on every result.
  // Cacheable list/read responses also require explicit conservative cache hints.
  const cacheable = new Set(['server/discover', 'tools/list', 'prompts/list', 'resources/list', 'resources/read']).has(msg?.method);
  return {
    ...result,
    resultType: result.resultType || 'complete',
    ...(cacheable ? { ttlMs: Number.isFinite(result.ttlMs) ? result.ttlMs : 0, cacheScope: result.cacheScope || 'private' } : {}),
    _meta: { ...(result._meta || {}), [SERVER_INFO_META]: serverInfo() },
  };
}
function write(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result, request = null) { write({ jsonrpc: '2.0', id, result: modernResult(result, request) }); }
function err(id, code, message, data) { write({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }); }

function execute(fn, args) {
  const [cmd, ...raw] = fn.command;
  const argv = raw.map((v, i) => (i === 0 && cmd === 'node' && !path.isAbsolute(v)) ? path.join(ROOT, v) : v);
  const r = spawnSync(cmd === 'node' ? process.execPath : cmd, argv, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    input: JSON.stringify(args || {}),
    maxBuffer: 1024 * 1024,
    timeout: Math.max(1000, Number(fn.timeoutMs) || 30000),
  });
  const stdout = (r.stdout || '').trim();
  const stderr = (r.stderr || '').trim();
  let parsed = null;
  if (stdout) { try { parsed = JSON.parse(stdout); } catch { /* text result */ } }
  const text = stdout || stderr || (r.status === 0 ? 'ok' : `command failed with exit ${r.status}`);
  return {
    content: [{ type: 'text', text }],
    ...(parsed && typeof parsed === 'object' ? { structuredContent: parsed } : {}),
    ...(r.status === 0 ? {} : { isError: true }),
  };
}

function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const id = msg.id;
  const method = msg.method;
  const protocol = requestProtocol(msg);

  if (protocol && protocol !== MODERN_PROTOCOL && method !== 'initialize') {
    return err(id, -32022, 'Unsupported protocol version', { supported: [MODERN_PROTOCOL], requested: protocol });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;

  if (method === 'server/discover') {
    return ok(id, {
      resultType: 'complete',
      supportedVersions: [MODERN_PROTOCOL],
      capabilities: capabilities(),
      instructions: 'SI-Coder exposes secret-safe web-app build/provider/verification tools. Raw provider credentials are never accepted in MCP tool arguments.',
      ttlMs: 3600000,
      cacheScope: 'public',
    }, msg);
  }

  if (method === 'initialize') {
    // Legacy-era compatibility only. 2026 clients discover the server instead and do not
    // perform this handshake.
    return ok(id, {
      protocolVersion: LEGACY_PROTOCOL,
      capabilities: capabilities(),
      serverInfo: serverInfo(),
    }, msg);
  }
  if (method === 'ping') return ok(id, {}, msg);
  if (method === 'tools/list') {
    return ok(id, { tools: FUNCTIONS.map(f => ({ name: f.name, description: f.description, inputSchema: f.inputSchema })) }, msg);
  }
  if (method === 'tools/call') {
    const name = msg.params?.name;
    const fn = BY_NAME.get(name);
    if (!fn) return err(id, -32602, `unknown tool ${JSON.stringify(name)}`);
    try { return ok(id, execute(fn, msg.params?.arguments || {}), msg); }
    catch (e) { return err(id, -32603, e.message); }
  }
  if (method === 'resources/list') return ok(id, { resources: [] }, msg);
  if (method === 'prompts/list') return ok(id, { prompts: [] }, msg);
  if (id !== undefined) return err(id, -32601, `method not found: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  while (true) {
    const i = buf.indexOf('\n');
    if (i < 0) break;
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { process.stderr.write(`si-coder mcp: ${e.message}\n`); }
  }
});
