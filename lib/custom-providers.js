// custom-providers.js — user-owned provider definitions, never credential values.
//
// Built-ins stay code-reviewed in lib/providers.js. This file stores only declarative
// metadata for extra providers in ~/.config/si-coder/providers.json (0600): provider id,
// title/blurb, env-key names, acquisition navigation, and simple validation hints. Secret VALUES
// live in user/provider/connection stores (legacy profile/bashrc remains compatibility only).
const fs = require('fs');
const path = require('path');
const { CUSTOM_PROVIDERS_FILE, ensureConfigDir } = require(path.resolve(__dirname, 'config'));

const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const KEY_RE = /^[A-Z][A-Z0-9_]{1,127}$/;

function emptyDoc() { return { version: 1, providers: [] }; }

function readDoc(file = CUSTOM_PROVIDERS_FILE) {
  if (!fs.existsSync(file)) return emptyDoc();
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`invalid ${file}: ${e.message}`); }
  if (!doc || doc.version !== 1 || !Array.isArray(doc.providers)) {
    throw new Error(`invalid ${file}: expected { version: 1, providers: [] }`);
  }
  return doc;
}

function writeDoc(doc, file = CUSTOM_PROVIDERS_FILE) {
  ensureConfigDir();
  const body = `${JSON.stringify(doc, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

function assertId(id) {
  if (!ID_RE.test(String(id || ''))) throw new Error(`invalid provider id ${JSON.stringify(id)} — use lowercase letters, digits, . _ -`);
  return id;
}

function assertKey(key) {
  if (!KEY_RE.test(String(key || ''))) throw new Error(`invalid env key ${JSON.stringify(key)} — expected UPPER_SNAKE_CASE`);
  return key;
}

function cleanText(v, max = 500) {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (!s || s.length > max || /[\r\n\0]/.test(s)) throw new Error('metadata text must be one line and within the size limit');
  return s;
}


function cleanNavigation(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const rows = Array.isArray(v) ? v : String(v).split(/\s*(?:>|→)\s*/);
  const out = rows.map(x => cleanText(x, 240)).filter(Boolean);
  if (!out.length || out.length > 20) throw new Error('navigation must contain 1..20 short steps');
  return out;
}
function normalizeVar(raw) {
  const out = {
    key: assertKey(raw.key),
    required: Boolean(raw.required),
    secret: raw.secret !== false,
  };
  if (raw.url !== undefined) {
    const u = cleanText(raw.url, 1000);
    if (!/^https:\/\//.test(u)) throw new Error(`${out.key}: source URL must use https://`);
    out.url = u;
  }
  if (raw.note !== undefined) out.note = cleanText(raw.note, 1000);
  if (raw.navigation !== undefined) out.navigation = cleanNavigation(raw.navigation);
  if (raw.prefix !== undefined) out.prefix = cleanText(raw.prefix, 200);
  if (raw.minLength !== undefined) {
    const n = Number(raw.minLength);
    if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error(`${out.key}: minLength must be 1..10000`);
    out.minLength = n;
  }
  if (!out.url && !out.note) out.note = `credential for custom provider ${raw.providerId || ''}`.trim();
  return out;
}

function normalizeProvider(raw) {
  const id = assertId(raw.id);
  const vars = Array.isArray(raw.vars) ? raw.vars.map(v => normalizeVar({ ...v, providerId: id })) : [];
  if (!vars.length) throw new Error(`${id}: a provider needs at least one env key`);
  const seen = new Set();
  for (const v of vars) {
    if (seen.has(v.key)) throw new Error(`${id}: duplicate env key ${v.key}`);
    seen.add(v.key);
  }
  return {
    id,
    title: cleanText(raw.title, 120) || id,
    blurb: cleanText(raw.blurb, 500) || 'custom credential provider',
    vars,
  };
}

function validateDoc(doc, { builtInIds = [], builtInKeys = [] } = {}) {
  const ids = new Set(builtInIds);
  const keys = new Set(builtInKeys);
  const providers = doc.providers.map(normalizeProvider);
  for (const p of providers) {
    if (ids.has(p.id)) throw new Error(`custom provider ${p.id} collides with a built-in provider`);
    ids.add(p.id);
    for (const v of p.vars) {
      if (keys.has(v.key)) throw new Error(`${p.id}: env key ${v.key} collides with another provider`);
      keys.add(v.key);
    }
  }
  return { version: 1, providers };
}

function validatorFor(v) {
  return value => {
    const s = String(value || '');
    if (v.minLength && s.length < v.minLength) return false;
    if (v.prefix && !s.startsWith(v.prefix)) return false;
    return s.length > 0;
  };
}

function runtimeProvider(def) {
  return {
    id: def.id,
    title: def.title,
    blurb: def.blurb,
    status: 'custom',
    vars: def.vars.map(v => ({ ...v, validate: validatorFor(v) })),
    async check(env) {
      const set = def.vars.filter(v => env[v.key]).length;
      return { ok: null, detail: `custom provider — ${set}/${def.vars.length} credential value(s) present; no live probe configured` };
    },
  };
}

function loadCustomProviderDefs(options = {}, file = CUSTOM_PROVIDERS_FILE) {
  return validateDoc(readDoc(file), options).providers;
}

function loadCustomProviders(options = {}, file = CUSTOM_PROVIDERS_FILE) {
  return loadCustomProviderDefs(options, file).map(runtimeProvider);
}

function mutate(mutator, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  const doc = validateDoc(readDoc(file), options);
  const next = mutator({ version: 1, providers: doc.providers.map(p => ({ ...p, vars: p.vars.map(v => ({ ...v })) })) });
  const clean = validateDoc(next, options);
  writeDoc(clean, file);
  return clean;
}

function createProvider(def, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  const normalized = normalizeProvider(def);
  mutate(doc => {
    if (doc.providers.some(p => p.id === normalized.id)) throw new Error(`provider ${normalized.id} already exists`);
    doc.providers.push(normalized);
    doc.providers.sort((a, b) => a.id.localeCompare(b.id));
    return doc;
  }, options, file);
  return normalized;
}

function updateProvider(id, patch, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  assertId(id);
  let updated;
  mutate(doc => {
    const i = doc.providers.findIndex(p => p.id === id);
    if (i < 0) throw new Error(`custom provider ${id} not found`);
    updated = normalizeProvider({ ...doc.providers[i], ...patch, id });
    doc.providers[i] = updated;
    return doc;
  }, options, file);
  return updated;
}

function deleteProvider(id, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  assertId(id);
  let removed;
  mutate(doc => {
    const i = doc.providers.findIndex(p => p.id === id);
    if (i < 0) throw new Error(`custom provider ${id} not found`);
    [removed] = doc.providers.splice(i, 1);
    return doc;
  }, options, file);
  return removed;
}

function addProviderVar(id, variable, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  assertId(id);
  const v = normalizeVar({ ...variable, providerId: id });
  let updated;
  mutate(doc => {
    const p = doc.providers.find(x => x.id === id);
    if (!p) throw new Error(`custom provider ${id} not found`);
    if (p.vars.some(x => x.key === v.key)) throw new Error(`${id} already has ${v.key}`);
    p.vars.push(v);
    updated = normalizeProvider(p);
    Object.assign(p, updated);
    return doc;
  }, options, file);
  return v;
}

function removeProviderVar(id, key, options = {}, file = CUSTOM_PROVIDERS_FILE) {
  assertId(id); assertKey(key);
  let removed;
  mutate(doc => {
    const p = doc.providers.find(x => x.id === id);
    if (!p) throw new Error(`custom provider ${id} not found`);
    const i = p.vars.findIndex(v => v.key === key);
    if (i < 0) throw new Error(`${id} does not define ${key}`);
    if (p.vars.length === 1) throw new Error(`cannot remove ${key}: a provider needs at least one env key; delete the provider instead`);
    [removed] = p.vars.splice(i, 1);
    return doc;
  }, options, file);
  return removed;
}

module.exports = {
  ID_RE, KEY_RE,
  readDoc, writeDoc, validateDoc, normalizeProvider, normalizeVar,
  loadCustomProviderDefs, loadCustomProviders,
  createProvider, updateProvider, deleteProvider, addProviderVar, removeProviderVar,
};
