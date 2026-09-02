'use strict';

// connections.js — multiple named provider connections per SI-Coder user.
// Secret values live only in private .env files. Metadata (label/auth/scope/default)
// is separate so the Finder and agents can identify an account without reading it.
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR, ensureConfigDir } = require('./config');
const { parseEnvString, shSingleQuote } = require('./env');

const CONNECTIONS_DIR = path.join(CONFIG_DIR, 'connections');
const CONNECTION_META = path.join(CONFIG_DIR, 'connections.json');
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const USER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SOURCE_IDS = new Set(['sc', 'composio', 'native-mcp']);

function ensureDirs() {
  ensureConfigDir();
  fs.mkdirSync(CONNECTIONS_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(CONNECTIONS_DIR, 0o700); } catch {}
}

function emptyMeta() { return { version: 2, users: {} }; }
function inferSource(meta = {}) {
  if (SOURCE_IDS.has(meta.source)) return meta.source;
  if (meta.authMethod === 'mcp-oauth' || meta.authMethod === 'dcr-oauth') return 'native-mcp';
  if (meta.authMethod === 'oauth2' && meta.external !== false) return 'composio';
  return 'sc';
}
function normalizeMeta(doc) {
  if (!doc || typeof doc !== 'object' || !doc.users || typeof doc.users !== 'object') return emptyMeta();
  const out = JSON.parse(JSON.stringify(doc));
  const fromVersion = Number(out.version || 1);
  out.version = 2;
  for (const [userName, user] of Object.entries(out.users || {})) {
    user.providers ||= {};
    for (const [providerId, node] of Object.entries(user.providers || {})) {
      node.connections ||= {};
      for (const [connectionId, meta] of Object.entries(node.connections || {})) {
        const oldSource = meta.source;
        meta.source = inferSource(meta);
        if (oldSource && !SOURCE_IDS.has(oldSource) && !meta.origin) meta.origin = oldSource;
        if (providerId === 'github' && meta.source === 'sc' && meta.authMethod === 'personal-access-token') {
          const token = readValues(userName, providerId, connectionId).GITHUB_TOKEN || '';
          meta.authMethod = String(token).startsWith('github_pat_') ? 'fine-grained-pat' : 'classic-pat';
        }
        if (meta.source === 'native-mcp' && meta.authMethod === 'mcp-oauth') meta.authMethod = 'dcr-oauth';
        if (meta.external && typeof meta.external !== 'object') delete meta.external;
      }
    }
  }
  Object.defineProperty(out, '_fromVersion', { value: fromVersion, enumerable: false });
  return out;
}
function readMeta() {
  if (!fs.existsSync(CONNECTION_META)) return emptyMeta();
  try {
    const doc = JSON.parse(fs.readFileSync(CONNECTION_META, 'utf8'));
    return normalizeMeta(doc);
  } catch { return emptyMeta(); }
}
function writeMeta(doc) {
  ensureDirs();
  doc = normalizeMeta(doc);
  const tmp = `${CONNECTION_META}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CONNECTION_META);
  fs.chmodSync(CONNECTION_META, 0o600);
}
function migrateMetadata({ backup = true } = {}) {
  if (!fs.existsSync(CONNECTION_META)) return { changed: false, fromVersion: 2, toVersion: 2, backup: null };
  const rawText = fs.readFileSync(CONNECTION_META, 'utf8');
  let raw;
  try { raw = JSON.parse(rawText); } catch { throw new Error('connections metadata is not valid JSON'); }
  const fromVersion = Number(raw?.version || 1);
  if (fromVersion >= 2) return { changed: false, fromVersion, toVersion: 2, backup: null };
  let backupPath = null;
  if (backup) {
    backupPath = `${CONNECTION_META}.v${fromVersion}.backup`;
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, rawText, { mode: 0o600 });
      fs.chmodSync(backupPath, 0o600);
    }
  }
  writeMeta(normalizeMeta(raw));
  return { changed: true, fromVersion, toVersion: 2, backup: backupPath };
}

function assertUser(user) {
  if (!USER_RE.test(String(user || ''))) throw new Error(`invalid user ${JSON.stringify(user)}`);
  return user;
}
function assertId(id, what = 'connection') {
  if (!ID_RE.test(String(id || ''))) throw new Error(`invalid ${what} id ${JSON.stringify(id)} — use lowercase letters, digits, . _ -`);
  return id;
}
function cleanLabel(label) {
  const s = String(label || '').trim();
  if (!s || s.length > 120 || /[\r\n\0]/.test(s)) throw new Error('connection label must be 1..120 characters on one line');
  return s;
}
function slugify(label) {
  const base = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return ID_RE.test(base) ? base : 'connection';
}
function providerDir(user, provider) {
  return path.join(CONNECTIONS_DIR, assertUser(user), assertId(provider, 'provider'));
}
function connectionPath(user, provider, id) {
  return path.join(providerDir(user, provider), `${assertId(id)}.env`);
}
function readValues(user, provider, id) {
  const file = connectionPath(user, provider, id);
  if (!fs.existsSync(file)) return {};
  const env = parseEnvString(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(env)) env[k] = env[k].replace(/'\\''/g, "'");
  return env;
}
function writeValues(user, provider, id, updates, { replace = false } = {}) {
  ensureDirs();
  const dir = providerDir(user, provider);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(path.join(CONNECTIONS_DIR, assertUser(user)), 0o700); fs.chmodSync(dir, 0o700); } catch {}
  const merged = replace ? { ...updates } : { ...readValues(user, provider, id), ...updates };
  for (const k of Object.keys(merged)) if (merged[k] === undefined || merged[k] === null) delete merged[k];
  const body = Object.entries(merged).map(([k, v]) => `${k}=${shSingleQuote(v)}`).join('\n');
  const file = connectionPath(user, provider, id);
  fs.writeFileSync(file, `${body}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return merged;
}
function removeValues(user, provider, id, keys) {
  const cur = readValues(user, provider, id);
  const removed = keys.filter(k => Object.prototype.hasOwnProperty.call(cur, k));
  for (const k of removed) delete cur[k];
  writeValues(user, provider, id, cur, { replace: true });
  return removed;
}

function providerNode(doc, user, provider, create = false) {
  if (create) {
    doc.users[user] ||= { providers: {} };
    doc.users[user].providers ||= {};
    doc.users[user].providers[provider] ||= { default: null, connections: {} };
  }
  return doc.users?.[user]?.providers?.[provider] || null;
}

function list(user, provider = null) {
  assertUser(user);
  const doc = readMeta();
  const providers = provider ? [assertId(provider, 'provider')] : Object.keys(doc.users?.[user]?.providers || {}).sort();
  const out = [];
  for (const pid of providers) {
    const node = providerNode(doc, user, pid, false);
    if (!node) continue;
    for (const [id, meta] of Object.entries(node.connections || {}).sort((a,b)=>a[0].localeCompare(b[0]))) {
      const values = readValues(user, pid, id);
      out.push({
        user, provider: pid, id, label: meta.label || id,
        source: meta.source || 'sc', authMethod: meta.authMethod || 'direct', scope: meta.scope || 'account',
        isDefault: node.default === id, keyCount: Object.keys(values).length,
        keyNames: Object.keys(values).sort(), createdAt: meta.createdAt || null, updatedAt: meta.updatedAt || null,
        origin: meta.origin || null,
        external: meta.external && typeof meta.external === 'object' ? { ...meta.external } : null,
      });
    }
  }
  return out;
}
function get(user, provider, id) {
  const row = list(user, provider).find(x => x.id === id);
  if (!row) throw new Error(`connection ${user}/${provider}/${id} not found`);
  return row;
}
function uniqueId(user, provider, label) {
  const used = new Set(list(user, provider).map(x => x.id));
  const base = slugify(label);
  if (!used.has(base)) return base;
  for (let i=2;i<1000;i++) {
    const suffix = `-${i}`;
    const id = `${base.slice(0, 64-suffix.length)}${suffix}`;
    if (!used.has(id)) return id;
  }
  throw new Error('could not allocate a unique connection id');
}
function create(user, provider, { id, label, source = 'sc', authMethod = 'direct', scope = 'account', setDefault = false, origin = null, external = null } = {}) {
  assertUser(user); assertId(provider, 'provider');
  if (!SOURCE_IDS.has(source)) throw new Error(`invalid connection source ${JSON.stringify(source)}; expected sc, composio, or native-mcp`);
  label = cleanLabel(label || id || 'Default');
  const duplicateLabel = list(user, provider).find(x => x.label.toLowerCase() === label.toLowerCase());
  if (duplicateLabel) throw new Error(`connection label ${JSON.stringify(label)} already exists for ${user}/${provider}`);
  id = id ? assertId(id) : uniqueId(user, provider, label);
  const doc = readMeta();
  const node = providerNode(doc, user, provider, true);
  if (node.connections[id]) throw new Error(`connection ${id} already exists for ${user}/${provider}`);
  const now = new Date().toISOString();
  node.connections[id] = {
    label, source, authMethod: String(authMethod), scope: String(scope || 'account'), createdAt: now, updatedAt: now,
    ...(origin ? { origin } : {}),
    ...(external && typeof external === 'object' ? { external: { ...external } } : {}),
  };
  if (!node.default || setDefault) node.default = id;
  writeMeta(doc);
  if (source === 'sc') writeValues(user, provider, id, {});
  return get(user, provider, id);
}
function setExternal(user, provider, id, external) {
  get(user, provider, id);
  if (!external || typeof external !== 'object' || Array.isArray(external)) throw new Error('external connection metadata must be an object');
  const doc = readMeta();
  const node = providerNode(doc, user, provider, true);
  node.connections[id].external = { ...(node.connections[id].external || {}), ...external };
  node.connections[id].updatedAt = new Date().toISOString();
  writeMeta(doc);
  return get(user, provider, id);
}
function setDefault(user, provider, id) {
  get(user, provider, id);
  const doc = readMeta();
  const node = providerNode(doc, user, provider, true);
  node.default = id;
  node.connections[id].updatedAt = new Date().toISOString();
  writeMeta(doc);
  return get(user, provider, id);
}
function setLabel(user, provider, id, label) {
  get(user, provider, id); label = cleanLabel(label);
  const duplicate = list(user, provider).find(x => x.id !== id && x.label.toLowerCase() === label.toLowerCase());
  if (duplicate) throw new Error(`connection label ${JSON.stringify(label)} already exists for ${user}/${provider}`);
  const doc = readMeta();
  const node = providerNode(doc, user, provider, true);
  node.connections[id].label = label;
  node.connections[id].updatedAt = new Date().toISOString();
  writeMeta(doc);
  return get(user, provider, id);
}
function remove(user, provider, id) {
  const row = get(user, provider, id);
  const doc = readMeta();
  const node = providerNode(doc, user, provider, false);
  delete node.connections[id];
  if (node.default === id) node.default = Object.keys(node.connections)[0] || null;
  if (!Object.keys(node.connections).length) delete doc.users[user].providers[provider];
  if (!Object.keys(doc.users[user].providers || {}).length) delete doc.users[user];
  writeMeta(doc);
  const file = connectionPath(user, provider, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const pdir = providerDir(user, provider);
  try { if (fs.existsSync(pdir) && fs.readdirSync(pdir).length === 0) fs.rmdirSync(pdir); } catch {}
  const udir = path.join(CONNECTIONS_DIR, user);
  try { if (fs.existsSync(udir) && fs.readdirSync(udir).length === 0) fs.rmdirSync(udir); } catch {}
  return row;
}
function selected(user, provider, explicit = null) {
  if (explicit) return get(user, provider, explicit);
  const doc = readMeta();
  const node = providerNode(doc, user, provider, false);
  if (!node) return null;
  if (node.default && node.connections?.[node.default]) return get(user, provider, node.default);
  const first = Object.keys(node.connections || {})[0];
  return first ? get(user, provider, first) : null;
}

function deleteUser(user) {
  assertUser(user);
  const doc = readMeta();
  if (doc.users[user]) { delete doc.users[user]; writeMeta(doc); }
  const dir = path.join(CONNECTIONS_DIR, user);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function duplicateUser(source, target) {
  assertUser(source); assertUser(target);
  const doc = readMeta();
  const src = doc.users[source];
  if (!src) return { connections: 0 };
  if (doc.users[target]) throw new Error(`target user ${target} already has connection metadata`);
  const now = new Date().toISOString();
  doc.users[target] = JSON.parse(JSON.stringify(src));
  for (const node of Object.values(doc.users[target].providers || {})) for (const meta of Object.values(node.connections || {})) {
    meta.duplicatedFrom = source; meta.updatedAt = now;
  }
  writeMeta(doc);
  const srcDir = path.join(CONNECTIONS_DIR, source), dstDir = path.join(CONNECTIONS_DIR, target);
  if (fs.existsSync(srcDir)) fs.cpSync(srcDir, dstDir, { recursive: true, force: false });
  let n=0; for (const p of Object.keys(src.providers || {})) n += Object.keys(src.providers[p].connections || {}).length;
  return { connections: n };
}
function renameUser(source, target) {
  assertUser(source); assertUser(target);
  const doc = readMeta();
  if (doc.users[target]) throw new Error(`target user ${target} already has connection metadata`);
  if (doc.users[source]) { doc.users[target] = doc.users[source]; delete doc.users[source]; writeMeta(doc); }
  const srcDir = path.join(CONNECTIONS_DIR, source), dstDir = path.join(CONNECTIONS_DIR, target);
  if (fs.existsSync(srcDir)) fs.renameSync(srcDir, dstDir);
}

function sourceOptions(provider) {
  const configured = provider.sources && typeof provider.sources === 'object' ? provider.sources : {};
  const direct = configured.sc || { label: 'SI-Coder direct', description: 'Store access securely on this machine' };
  const rows = [{ id: 'sc', ...direct }];
  for (const [id, meta] of Object.entries(configured)) if (id !== 'sc') rows.push({ id, ...meta });
  return rows;
}
function sourceOption(provider, id) {
  const row = sourceOptions(provider).find(x => x.id === id);
  if (!row) throw new Error(`${provider.id}: unknown connection source ${id}; expected ${sourceOptions(provider).map(x=>x.id).join(', ')}`);
  return row;
}
function authOptions(provider, source = 'sc') {
  const sourceMeta = sourceOption(provider, source);
  if (source !== 'sc') {
    if (Array.isArray(sourceMeta.auth) && sourceMeta.auth.length) return sourceMeta.auth.map(x => ({ ...x, external: true }));
    return (sourceMeta.authSchemes || []).map(scheme => ({
      id: String(scheme).toLowerCase().replace(/_/g, '-'),
      label: scheme === 'OAUTH2' ? 'OAuth2' : scheme === 'DCR_OAUTH' ? 'OAuth (DCR)' : scheme.replace(/_/g, ' '),
      scheme, scope: sourceMeta.scope || 'account', fields: [], external: true,
      recommended: sourceMeta.recommended || null,
    }));
  }
  const direct = { id: 'direct', label: 'Direct credential', scheme: 'API_KEY', scope: 'account', fields: provider.vars.map(v => v.key) };
  return Array.isArray(provider.auth) && provider.auth.length ? provider.auth : [direct];
}
function authOption(provider, sourceOrId, maybeId = undefined) {
  const source = maybeId === undefined ? 'sc' : sourceOrId;
  const id = maybeId === undefined ? sourceOrId : maybeId;
  const row = authOptions(provider, source).find(x => x.id === id);
  if (!row) throw new Error(`${provider.id}/${source}: unknown auth method ${id}; expected ${authOptions(provider, source).map(x=>x.id).join(', ')}`);
  return row;
}
function connectionFields(provider, connection) {
  const method = authOption(provider, connection.source || 'sc', connection.authMethod);
  const keys = new Set(method.fields || []);
  return provider.vars.filter(v => keys.has(v.key));
}

function migrateLegacy(user, legacyEnv, providers, { removeLegacy = null } = {}) {
  const migratedKeys = [];
  const created = [];
  for (const provider of providers) {
    if (list(user, provider.id).length) continue;
    const present = provider.vars.filter(v => legacyEnv[v.key] !== undefined);
    if (!present.length) continue;
    const options = authOptions(provider).filter(o => (o.fields || []).some(k => legacyEnv[k] !== undefined));
    const method = options.sort((a,b) => (b.fields||[]).filter(k=>legacyEnv[k]!==undefined).length - (a.fields||[]).filter(k=>legacyEnv[k]!==undefined).length)[0]
      || { id:'direct', label:'Direct credential', scope:'account', fields:present.map(v=>v.key) };
    let label = `Default ${provider.title || provider.id}`;
    if (provider.id === 'convex-cloud' && legacyEnv.CONVEX_DEPLOY_KEY) {
      const head = String(legacyEnv.CONVEX_DEPLOY_KEY).split('|')[0];
      label = head || 'Default deployment';
    }
    const row = create(user, provider.id, { id:'default', label, source:'sc', authMethod:method.id, scope:method.scope || 'account', setDefault:true, origin:'legacy-profile' });
    const allowed = new Set(method.fields || present.map(v=>v.key));
    const updates = {};
    for (const v of present) if (allowed.has(v.key)) { updates[v.key] = legacyEnv[v.key]; migratedKeys.push(v.key); }
    if (provider.id === 'convex-cloud' && method.id === 'deployment-key' && !updates.CONVEX_DEPLOYMENT_NAME && updates.CONVEX_DEPLOY_KEY) {
      const head = String(updates.CONVEX_DEPLOY_KEY).split('|')[0];
      const match = /^(?:prod|dev):([^:|]+)$/.exec(head);
      if (match) updates.CONVEX_DEPLOYMENT_NAME = match[1];
    }
    writeValues(user, provider.id, row.id, updates);
    created.push({ provider: provider.id, connection: row.id, label, authMethod: method.id, keyCount: Object.keys(updates).length });
  }
  if (removeLegacy && migratedKeys.length) removeLegacy([...new Set(migratedKeys)]);
  return { user, created, migratedKeys: [...new Set(migratedKeys)].sort() };
}

module.exports = {
  CONNECTIONS_DIR, CONNECTION_META, ID_RE, SOURCE_IDS,
  ensureDirs, readMeta, writeMeta, normalizeMeta, migrateMetadata, assertId, slugify, connectionPath,
  list, get, create, setDefault, setLabel, setExternal, remove, selected,
  readValues, writeValues, removeValues, deleteUser, duplicateUser, renameUser,
  sourceOptions, sourceOption, authOptions, authOption, connectionFields, migrateLegacy,
};
