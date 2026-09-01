'use strict';

// Secret-safe user/provider/connection/credential read model shared by TUI + agents.
const path = require('path');
const P = require('./profiles');
const C = require('./connections');
const { PROVIDERS, VALIDATORS } = require('./providers');
const { credentialGuide } = require('./credential-guidance');

const byId = new Map(PROVIDERS.map(p => [p.id, p]));

function requireUser(name) {
  P.assertName(name);
  if (!P.profileExists(name)) throw new Error(`no such user "${name}"`);
  return name;
}
function requireProvider(id) {
  const p = byId.get(String(id || ''));
  if (!p) throw new Error(`unknown provider "${id || ''}"`);
  return p;
}
function methodFor(provider, connection) { return C.authOption(provider, connection.authMethod); }
function fieldsFor(provider, connection) { return C.connectionFields(provider, connection); }

function credentialRow(user, provider, v, own, connection = null, requiredOverride = null) {
  const required = requiredOverride === null ? Boolean(v.required) : Boolean(requiredOverride);
  const stored = own[v.key] !== undefined;
  const valid = stored && (!VALIDATORS[v.key] || VALIDATORS[v.key](own[v.key]));
  return {
    key: v.key,
    required,
    secret: v.secret !== false,
    state: !stored ? (required ? 'missing' : 'unset') : (valid ? 'stored' : 'invalid'),
    stored, valid, owner: user, readable: false,
    connection: connection?.id || null,
  };
}
function summarize(credentials, { external = false } = {}) {
  const stored = credentials.filter(x => x.stored).length;
  const invalid = credentials.filter(x => x.state === 'invalid').length;
  const missingRequired = credentials.filter(x => x.state === 'missing').length;
  let state = external ? 'external-auth' : 'empty';
  if (invalid) state = 'invalid';
  else if (missingRequired) state = 'incomplete';
  else if (stored || (!credentials.length && external)) state = external ? 'external-auth' : 'ready';
  return { state, stored, total: credentials.length, invalid, missingRequired };
}

function connectionStatus(user, providerId, connectionId) {
  requireUser(user);
  const p = requireProvider(providerId);
  const conn = C.get(user, providerId, connectionId);
  const method = methodFor(p, conn);
  const own = C.readValues(user, providerId, connectionId);
  const fields = fieldsFor(p, conn);
  const requiredKeys = new Set(method.requiredFields || fields.filter(v => v.required).map(v => v.key));
  const credentials = fields.map(v => credentialRow(user, p, v, own, conn, requiredKeys.has(v.key)));
  return {
    user, provider: providerId,
    id: conn.id, label: conn.label, authMethod: conn.authMethod, scheme: method.scheme,
    scope: conn.scope || method.scope || 'account', isDefault: conn.isDefault,
    external: Boolean(method.external), composio: p.composio || null,
    ...summarize(credentials, { external: Boolean(method.external) }),
    credentials,
  };
}
function connectionsStatus(user, providerId = null) {
  requireUser(user);
  const rows = C.list(user, providerId);
  return rows.map(r => connectionStatus(user, r.provider, r.id));
}

function legacyProviderStatus(user, providerId) {
  const p = requireProvider(providerId);
  const own = P.readProfile(user);
  const credentials = p.vars.map(v => credentialRow(user, p, v, own, null));
  return {
    user, id: p.id, title: p.title, blurb: p.blurb, providerStatus: p.status,
    connection: null, connectionLabel: null, authMethod: 'legacy-profile', scope: 'legacy', legacy: true,
    ...summarize(credentials), credentials,
  };
}
function providerStatus(user, providerId, connectionId = null) {
  requireUser(user);
  const p = requireProvider(providerId);
  const connections = C.list(user, providerId);
  const selected = connectionId ? C.get(user, providerId, connectionId) : C.selected(user, providerId);
  if (selected) {
    const st = connectionStatus(user, providerId, selected.id);
    return {
      user, id: p.id, title: p.title, blurb: p.blurb, providerStatus: p.status,
      connection: st.id, connectionLabel: st.label, authMethod: st.authMethod, scope: st.scope,
      connectionCount: connections.length, defaultConnection: connections.find(x => x.isDefault)?.id || null,
      legacy: false, state: st.state, stored: st.stored, total: st.total, invalid: st.invalid,
      missingRequired: st.missingRequired, credentials: st.credentials, external: st.external,
      composio: p.composio || null,
    };
  }
  const legacy = legacyProviderStatus(user, providerId);
  return { ...legacy, connectionCount: connections.length, defaultConnection: null, composio: p.composio || null };
}
function userProviders(user, { includeEmpty = true } = {}) {
  requireUser(user);
  const rows = PROVIDERS.map(p => providerStatus(user, p.id));
  return includeEmpty ? rows : rows.filter(p => p.stored > 0 || p.connectionCount > 0 || p.invalid > 0);
}

function credentialStatus(user, providerId, key = null, connectionId = null) {
  const p = providerStatus(user, providerId, connectionId);
  if (!key) return p;
  const row = p.credentials.find(x => x.key === key);
  if (!row) throw new Error(`${providerId}${p.connection ? `/${p.connection}` : ''} does not define ${key} for auth method ${p.authMethod}`);
  const store = p.connection
    ? `SI-Coder connection "${p.connectionLabel}" (${C.connectionPath(user, providerId, p.connection)}, mode 0600)`
    : `legacy SI-Coder user store (${P.profilePath(user)}, mode 0600)`;
  const guide = credentialGuide(key, { user, connection: p.connection || undefined, store });
  return { ...row, provider: providerId, connection: p.connection, connectionLabel: p.connectionLabel, authMethod: p.authMethod, scope: p.scope, setup: guide };
}

function whichUser(cwd = process.cwd()) {
  const resolvedPath = path.resolve(P.expandHome(cwd));
  const { profile, reason, mapping, state } = P.resolveProfile(resolvedPath);
  return {
    cwd: resolvedPath,
    user: profile && P.profileExists(profile) ? profile : null,
    unresolvedUser: profile && !P.profileExists(profile) ? profile : null,
    reason,
    rule: mapping ? { path: mapping.path, user: mapping.profile } : null,
    defaultUser: state.active || null,
    mappings: state.mappings.map(m => ({ path: m.path, user: m.profile, exists: P.profileExists(m.profile) })),
  };
}
function showUser(name, cwd = process.cwd()) {
  requireUser(name);
  const st = P.parseScMd();
  const current = whichUser(cwd);
  const legacy = P.readProfile(name);
  const connections = C.list(name);
  const connectionKeyCount = connections.reduce((n, x) => n + x.keyCount, 0);
  const providers = userProviders(name, { includeEmpty: false });
  return {
    name, owner: P.profileOwner(name),
    credentialCount: Object.keys(legacy).length + connectionKeyCount,
    legacyCredentialCount: Object.keys(legacy).length,
    connectionCount: connections.length,
    credentialKeys: Object.keys(legacy).sort(),
    store: P.profilePath(name), connectionStore: path.join(C.CONNECTIONS_DIR, name),
    isDefault: st.active === name, isCurrent: current.user === name,
    folders: st.mappings.filter(m => m.profile === name).map(m => m.path),
    providers: providers.map(p => ({ id:p.id, state:p.state, stored:p.stored, total:p.total, connectionCount:p.connectionCount, defaultConnection:p.defaultConnection, connection:p.connection, authMethod:p.authMethod, invalid:p.invalid, missingRequired:p.missingRequired })),
  };
}
function listUsers(cwd = process.cwd()) {
  const current = whichUser(cwd), st = P.parseScMd();
  return { defaultUser: st.active || null, currentUser: current.user, currentReason: current.reason, users: P.listProfiles().map(name => showUser(name, cwd)) };
}

function previewForUser(name, cwd = process.cwd()) {
  const u = showUser(name, cwd);
  const lines = [
    `user ${u.name}${u.isDefault ? ' · default' : ''}${u.isCurrent ? ' · current' : ''}`,
    `${u.connectionCount} connection(s) · ${u.credentialCount} credential field(s) · values hidden`,
  ];
  if (u.providers.length) lines.push(`providers: ${u.providers.map(p => `${p.id}${p.connectionCount ? ` ×${p.connectionCount}` : ''}`).join(' · ')}`);
  else lines.push('providers: none configured');
  if (u.folders.length) lines.push(`folders: ${u.folders.join(', ')}`);
  return lines;
}
function previewForProvider(user, providerId) {
  const p = providerStatus(user, providerId);
  const lines = [
    `user ${user} › provider ${providerId}`,
    `${p.connectionCount || 0} connection(s)${p.connection ? ` · default: ${p.connectionLabel}` : p.legacy && p.stored ? ' · legacy credentials' : ''}`,
  ];
  if (p.connection) lines.push(`${p.authMethod} · ${p.scope} · ${p.stored}/${p.total} field(s) · ${p.state}`);
  else if (p.legacy && p.stored) lines.push(`legacy profile · ${p.stored}/${p.total} field(s) · ${p.state}`);
  else lines.push('no connection configured');
  if (p.composio?.authSchemes) lines.push(`Composio: ${p.composio.authSchemes.join(' / ')}`);
  return lines;
}
function previewForConnection(user, providerId, connectionId) {
  const c = connectionStatus(user, providerId, connectionId);
  return [
    `user ${user} › ${providerId} › ${c.label}${c.isDefault ? ' · default' : ''}`,
    `${c.scheme} · scope: ${c.scope}`,
    c.external ? 'external/managed auth · no local plaintext credential' : `${c.stored}/${c.total} field(s) · ${c.state}`,
    ...c.credentials.slice(0,1).map(x => `${x.state === 'stored' ? '✓' : '·'} ${x.key}: ${x.state}`),
  ];
}
function previewForCredential(user, providerId, key, connectionId = null) {
  const c = credentialStatus(user, providerId, key, connectionId);
  const sourceLine = c.setup?.referenceUrl ? `open: ${c.setup.referenceUrl}` : c.setup?.createCommand ? `get with: ${c.setup.createCommand}` : 'source: see instructions';
  const navLine = c.setup?.navigationText ? `click: ${c.setup.navigationText}` : c.setup?.note ? `how: ${c.setup.note}` : c.setup?.saveWith ? `set/rotate: ${c.setup.saveWith}` : '';
  return [
    `user ${user} › ${providerId}${c.connectionLabel ? ` › ${c.connectionLabel}` : ''} › ${key}`,
    `state: ${c.state} · plaintext read disabled`, sourceLine, navLine,
  ].filter(Boolean);
}
function previewForProviderSetup(user, providerId, connectionId = null) {
  const p = providerStatus(user, providerId, connectionId);
  const candidate = p.credentials.find(c => c.state === 'missing' || c.state === 'invalid') || p.credentials.find(c => c.state === 'unset') || p.credentials[0];
  if (!candidate) return [`user ${user} › provider ${providerId}`, p.external ? 'use external authentication flow' : 'no credential fields'];
  return previewForCredential(user, providerId, candidate.key, connectionId);
}

module.exports = {
  requireUser, requireProvider, providerStatus, userProviders, connectionStatus, connectionsStatus,
  credentialStatus, whichUser, showUser, listUsers,
  previewForUser, previewForProvider, previewForConnection, previewForCredential, previewForProviderSetup,
};
