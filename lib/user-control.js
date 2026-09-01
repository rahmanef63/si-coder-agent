'use strict';

// Secret-safe user/provider/credential read model shared by the CLI TUI and agent tools.
// This module may inspect stored values only to validate them; it never returns a value.
const path = require('path');
const P = require(path.resolve(__dirname, 'profiles'));
const { PROVIDERS, VALIDATORS } = require(path.resolve(__dirname, 'providers'));
const { credentialGuide } = require(path.resolve(__dirname, 'credential-guidance'));

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

function credentialRow(user, provider, v, own) {
  const stored = own[v.key] !== undefined;
  const valid = stored && (!VALIDATORS[v.key] || VALIDATORS[v.key](own[v.key]));
  return {
    key: v.key,
    required: Boolean(v.required),
    secret: v.secret !== false,
    state: !stored ? (v.required ? 'missing' : 'unset') : (valid ? 'stored' : 'invalid'),
    stored,
    valid,
    owner: user,
    readable: false,
  };
}

function providerStatus(user, providerId) {
  requireUser(user);
  const p = requireProvider(providerId);
  const own = P.readProfile(user);
  const credentials = p.vars.map(v => credentialRow(user, p, v, own));
  const stored = credentials.filter(x => x.stored).length;
  const invalid = credentials.filter(x => x.state === 'invalid').length;
  const missingRequired = credentials.filter(x => x.state === 'missing').length;
  let state = 'empty';
  if (invalid) state = 'invalid';
  else if (missingRequired) state = 'incomplete';
  else if (stored) state = 'ready';
  return {
    user,
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    providerStatus: p.status,
    state,
    stored,
    total: p.vars.length,
    invalid,
    missingRequired,
    credentials,
  };
}

function userProviders(user, { includeEmpty = true } = {}) {
  requireUser(user);
  const rows = PROVIDERS.map(p => providerStatus(user, p.id));
  return includeEmpty ? rows : rows.filter(p => p.stored > 0 || p.missingRequired > 0 || p.invalid > 0);
}

function credentialStatus(user, providerId, key = null) {
  const p = providerStatus(user, providerId);
  if (!key) return p;
  const row = p.credentials.find(x => x.key === key);
  if (!row) throw new Error(`${providerId} does not define ${key}`);
  const guide = credentialGuide(key, {
    user,
    store: `SI-Coder user "${user}" credential store (${P.profilePath(user)}, mode 0600)`,
  });
  return { ...row, provider: providerId, setup: guide };
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
  const own = P.readProfile(name);
  const providers = userProviders(name, { includeEmpty: false });
  return {
    name,
    owner: P.profileOwner(name),
    credentialCount: Object.keys(own).length,
    credentialKeys: Object.keys(own).sort(),
    store: P.profilePath(name),
    isDefault: st.active === name,
    isCurrent: current.user === name,
    folders: st.mappings.filter(m => m.profile === name).map(m => m.path),
    providers: providers.map(p => ({
      id: p.id,
      state: p.state,
      stored: p.stored,
      total: p.total,
      invalid: p.invalid,
      missingRequired: p.missingRequired,
    })),
  };
}

function listUsers(cwd = process.cwd()) {
  const current = whichUser(cwd);
  const st = P.parseScMd();
  return {
    defaultUser: st.active || null,
    currentUser: current.user,
    currentReason: current.reason,
    users: P.listProfiles().map(name => showUser(name, cwd)),
  };
}

function previewForUser(name, cwd = process.cwd()) {
  const u = showUser(name, cwd);
  const lines = [
    `user ${u.name}${u.isDefault ? ' · default' : ''}${u.isCurrent ? ' · current' : ''}`,
    `${u.credentialCount} credential(s) · values hidden`,
  ];
  if (u.providers.length) lines.push(`providers: ${u.providers.map(p => `${p.id} ${p.stored}/${p.total}`).join(' · ')}`);
  else lines.push('providers: none configured');
  if (u.folders.length) lines.push(`folders: ${u.folders.join(', ')}`);
  return lines;
}

function previewForProvider(user, providerId) {
  const p = providerStatus(user, providerId);
  const lines = [
    `user ${user} › provider ${providerId}`,
    `${p.stored}/${p.total} credential(s) · ${p.state}`,
  ];
  for (const c of p.credentials.slice(0, 4)) lines.push(`${c.state === 'stored' ? '✓' : c.state === 'invalid' ? '!' : '·'} ${c.key}: ${c.state}`);
  return lines;
}

function previewForCredential(user, providerId, key) {
  const c = credentialStatus(user, providerId, key);
  const sourceLine = c.setup?.referenceUrl
    ? `open: ${c.setup.referenceUrl}`
    : c.setup?.createCommand
      ? `get with: ${c.setup.createCommand}`
      : 'source: see instructions';
  const navLine = c.setup?.navigationText
    ? `click: ${c.setup.navigationText}`
    : c.setup?.note
      ? `how: ${c.setup.note}`
      : c.setup?.saveWith
        ? `set/rotate: ${c.setup.saveWith}`
        : '';
  return [
    `user ${user} › ${providerId} › ${key}`,
    `state: ${c.state} · plaintext read disabled`,
    sourceLine,
    navLine,
  ].filter(Boolean);
}

function previewForProviderSetup(user, providerId) {
  const p = providerStatus(user, providerId);
  const candidate = p.credentials.find(c => c.state === 'missing' || c.state === 'invalid') ||
    p.credentials.find(c => c.state === 'unset') || p.credentials[0];
  if (!candidate) return [`user ${user} › provider ${providerId}`, 'no credential fields'];
  return previewForCredential(user, providerId, candidate.key);
}

module.exports = {
  requireUser,
  requireProvider,
  providerStatus,
  userProviders,
  credentialStatus,
  whichUser,
  showUser,
  listUsers,
  previewForUser,
  previewForProvider,
  previewForCredential,
  previewForProviderSetup,
};
