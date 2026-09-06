'use strict';

// Secret-safe DOKU Streamable HTTP MCP client.
// Raw API keys stay in SC's private connection store. Only an ephemeral Basic
// header derived from apiKey + ':' is created in memory for each request.
const ENDPOINTS = Object.freeze({
  sandbox: 'https://api-sandbox.doku.com/doku-mcp-server/mcp',
  production: 'https://mcp.doku.com/mcp',
});
const PROTOCOL_VERSION = '2025-11-25';

function environment(value) {
  const env = String(value || 'sandbox').trim().toLowerCase();
  if (env !== 'sandbox' && env !== 'production') throw new Error('DOKU_MCP_ENV must be sandbox or production');
  return env;
}
function endpoint(env) { return ENDPOINTS[environment(env)]; }
function credentials(values = {}) {
  const clientId = String(values.DOKU_CLIENT_ID || '').trim();
  const apiKey = String(values.DOKU_MCP_API_KEY || '').trim();
  if (!clientId) throw new Error('DOKU_CLIENT_ID is not configured');
  if (!apiKey) throw new Error('DOKU_MCP_API_KEY is not configured');
  return { clientId, apiKey, env: environment(values.DOKU_MCP_ENV) };
}
function authHeaders(values, sessionId = null) {
  const c = credentials(values);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Client-Id': c.clientId,
    Authorization: `Basic ${Buffer.from(`${c.apiKey}:`, 'utf8').toString('base64')}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return { endpoint: endpoint(c.env), headers, environment: c.env };
}
function parseBody(text, contentType = '') {
  if (!text) return null;
  if (/application\/json/i.test(contentType)) return JSON.parse(text);
  if (/text\/event-stream/i.test(contentType)) {
    const messages = [];
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { messages.push(JSON.parse(data)); } catch { /* ignore keepalive/non-JSON event */ }
    }
    if (!messages.length) return null;
    return messages.findLast?.(msg => msg && (msg.result !== undefined || msg.error)) || messages[messages.length - 1];
  }
  try { return JSON.parse(text); } catch { return { message: String(text).slice(0, 1000) }; }
}
function safeError(body, status) {
  const message = body?.error?.message || body?.message || `DOKU MCP request failed (HTTP ${status})`;
  return new Error(String(message).slice(0, 1000));
}
async function post(values, payload, { fetchImpl = global.fetch, sessionId = null } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const auth = authHeaders(values, sessionId);
  const res = await fetchImpl(auth.endpoint, { method: 'POST', headers: auth.headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
  const body = parseBody(await res.text(), res.headers?.get?.('content-type') || '');
  if (!res.ok || body?.error) throw safeError(body, res.status);
  return { body, sessionId: res.headers?.get?.('mcp-session-id') || sessionId || null, environment: auth.environment };
}
async function openSession(values, options = {}) {
  const init = await post(values, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'si-coder', version: '0.9' } },
  }, options);
  // Streamable HTTP allows the initialized notification to return no JSON body.
  try {
    await post(values, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { ...options, sessionId: init.sessionId });
  } catch (e) {
    // Some stateless implementations do not acknowledge notifications. Only
    // tolerate an empty/non-JSON notification response; real auth/server errors
    // were already surfaced by post().
    if (!/JSON|empty|HTTP 202/i.test(String(e?.message || ''))) throw e;
  }
  return init;
}
async function request(values, method, params, options = {}) {
  const session = await openSession(values, options);
  const response = await post(values, { jsonrpc: '2.0', id: 2, method, params }, { ...options, sessionId: session.sessionId });
  return { result: response.body?.result ?? response.body, sessionId: response.sessionId, environment: response.environment };
}
async function tools(values, options = {}) { return request(values, 'tools/list', {}, options); }
async function call(values, name, args = {}, options = {}) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('tool name is required');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object');
  return request(values, 'tools/call', { name: name.trim(), arguments: args }, options);
}
module.exports = { ENDPOINTS, PROTOCOL_VERSION, environment, endpoint, credentials, authHeaders, parseBody, post, openSession, request, tools, call };
