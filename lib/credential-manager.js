'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const P = require('./profiles');
const C = require('./connections');
const CC = require('./composio-connections');
const { PROVIDERS } = require('./providers');
const { createCredentialSession, CredentialError } = require('./credential-session');
const { managerHtml } = require('./credential-manager-ui');
const MAX_BYTES = 16384;
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new CredentialError('invalid_request');
  return value;
}
async function jsonBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new CredentialError('json_required', 415);
  if (Number(req.headers['content-length']) > MAX_BYTES) throw new CredentialError('request_too_large', 413);
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BYTES) throw new CredentialError('request_too_large', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CredentialError('invalid_json'); }
}
function catalog() {
  return { users: P.listProfiles().map(name => ({ name, owner: P.profileOwner(name) })),
    providers: PROVIDERS.map(p => ({ id: p.id, title: p.title, description: p.blurb, status: p.status,
      sources: C.sourceOptions(p).map(s => ({ id: s.id, title: s.label, reference: s.reference || null, methods: C.authOptions(p, s.id).map(m => ({ id: m.id, label: m.label, scheme: m.scheme })) })) })),
    connections: P.listProfiles().flatMap(user => C.list(user).map(c => ({ user, provider: c.provider, id: c.id, label: c.label, source: c.source, authMethod: c.authMethod, isDefault: c.isDefault, fieldCount: c.keyCount, status: c.external?.lastKnownStatus || (c.keyCount ? 'configured' : 'empty') }))),
  };
}
async function startCredentialManager({ port = 0, user = null, providerId = null, connectionId = null, authMethod = null, ttlMs = 600000, check = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url'), hash = crypto.createHash('sha256').update(token).digest();
  const expiresAt = Date.now() + Math.min(Math.max(ttlMs, 1), 600000), forms = new Map();
  let busy = false, total = 0, timer, origin;
  const server = http.createServer(async (req, res) => {
    const common = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
    const send = (status, body) => { res.writeHead(status, { ...common, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) throw new CredentialError('origin_not_allowed', 403);
      if (req.method === 'GET' && req.url === '/') {
        const nonce = crypto.randomBytes(18).toString('base64');
        res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'` });
        return res.end(managerHtml(nonce));
      }
      const candidate = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1] || '';
      if (!crypto.timingSafeEqual(hash, crypto.createHash('sha256').update(candidate).digest()) || Date.now() >= expiresAt) throw new CredentialError('session_expired', 401);
      if (++total > 600) throw new CredentialError('rate_limited', 429);
      if (req.method === 'GET' && req.url === '/api/catalog') return send(200, { ...catalog(), selectedUser: user, selectedProvider: providerId, selectedConnection: connectionId, selectedMethod: authMethod, expiresAt });
      if (req.method !== 'POST' || req.url !== '/api/action') throw new CredentialError('not_found', 404);
      if (req.headers.origin !== origin) throw new CredentialError('origin_not_allowed', 403);
      if (busy) throw new CredentialError('busy', 409);
      const body = object(await jsonBody(req), ['action', 'selection', 'sessionId', 'values', 'allowUnverified', 'confirmation', 'user', 'owner', 'provider', 'connection', 'label', 'source', 'authMethod']);
      if (busy) throw new CredentialError('busy', 409);
      busy = true;
      try {
        if (body.action === 'select') {
          const selection = object(body.selection, ['user', 'providerId', 'connectionId', 'authMethod', 'source', 'newConnection', 'label']);
          if (forms.size >= 40) throw new CredentialError('too_many_forms', 429);
          const form = createCredentialSession(selection, { expiresAt, check }); const sessionId = crypto.randomBytes(16).toString('hex');
          forms.set(sessionId, form); return send(200, { sessionId, setup: form.schema() });
        }
        if (body.action === 'save') {
          const form = forms.get(body.sessionId); if (!form) throw new CredentialError('unknown_form');
          const allowUnverified = body.allowUnverified === true && body.confirmation === 'SAVE UNVERIFIED';
          return send(200, await form.save(body.values, { allowUnverified }));
        }
        if (body.action === 'user-create') {
          if (typeof body.user !== 'string' || body.user.length > 64 || P.profileExists(body.user)) throw new CredentialError('invalid_or_existing_user');
          P.assertName(body.user); const owner = P.assertOwner(body.owner || body.user); P.writeProfile(body.user, {}); P.setProfileOwner(body.user, owner); return send(200, { ok: true });
        }
        const p = PROVIDERS.find(p => p.id === body.provider);
        if (!p || !P.profileExists(body.user)) throw new CredentialError('unknown_selection');
        if (body.action === 'connection-create') {
          const method = C.authOption(p, body.source || 'sc', body.authMethod);
          const c = C.create(body.user, p.id, { label: body.label, source: body.source || 'sc', authMethod: method.id, scope: method.scope, setDefault: false });
          return send(200, { ok: true, connection: c.id });
        }
        const c = C.get(body.user, p.id, body.connection);
        if (body.action === 'connection-rename') C.setLabel(body.user, p.id, c.id, body.label);
        else if (body.action === 'connection-default') C.setDefault(body.user, p.id, c.id);
        else if (body.action === 'connection-delete') {
          if (body.confirmation !== c.label) throw new CredentialError('confirmation_required'); C.remove(body.user, p.id, c.id);
        } else if (body.action === 'external-authorize') {
          const result = await CC.authorize(body.user, p.id, c.id);
          const url = new URL(result.redirectUrl);
          if (url.protocol !== 'https:' || !['connect.composio.dev', 'backend.composio.dev', 'platform.composio.dev'].includes(url.hostname) || url.username || url.password) throw new CredentialError('invalid_authorization_url');
          return send(200, { ok: true, url: url.href, status: result.status });
        } else if (body.action === 'external-sync') {
          const result = await CC.sync(body.user, p.id, c.id); return send(200, { ok: true, status: result.status });
        } else throw new CredentialError('unknown_action');
        return send(200, { ok: true });
      } finally { busy = false; }
    } catch (e) { if (!res.headersSent) send(e instanceof CredentialError ? e.status : 400, { error: e instanceof CredentialError ? e.message : 'operation_failed_check_selection' }); else res.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port }, resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise(resolve => { clearTimeout(timer); forms.clear(); server.closeAllConnections(); server.close(resolve); });
  timer = setTimeout(close, Math.max(0, expiresAt - Date.now()) + 1000); timer.unref();
  return { server, origin, url: origin + '/#' + token, close };
}
module.exports = { startCredentialManager };
