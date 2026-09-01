#!/usr/bin/env node
// Minimal dependency-free MCP stdio server for the safe SI-Coder agent surface.
// Mirrors .mso/functions.json so MSO and MCP clients share schemas.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, '.mso/functions.json'), 'utf8'));
const FUNCTIONS = MANIFEST.functions.filter(f => f.name !== 'sc.verify');
const BY_NAME = new Map(FUNCTIONS.map(f => [f.name, f]));

function write(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function ok(id, result) { write({ jsonrpc: '2.0', id, result }); }
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
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: msg.params?.protocolVersion || '2025-11-25',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'si-coder', version: require('../package.json').version },
    });
  }
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') {
    return ok(id, { tools: FUNCTIONS.map(f => ({ name: f.name, description: f.description, inputSchema: f.inputSchema })) });
  }
  if (method === 'tools/call') {
    const name = msg.params?.name;
    const fn = BY_NAME.get(name);
    if (!fn) return err(id, -32602, `unknown tool ${JSON.stringify(name)}`);
    try { return ok(id, execute(fn, msg.params?.arguments || {})); }
    catch (e) { return err(id, -32603, e.message); }
  }
  if (method === 'resources/list') return ok(id, { resources: [] });
  if (method === 'prompts/list') return ok(id, { prompts: [] });
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
