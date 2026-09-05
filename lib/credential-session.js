'use strict';
// Shared write-only credential workflow for a single form and the full browser hub.
const P = require('./profiles');
const C = require('./connections');
const { PROVIDERS } = require('./providers');
const { credentialGuide } = require('./credential-guidance');
class CredentialError extends Error { constructor(code, status = 422) { super(code); this.status = status; } }
function createCredentialSession(selection, options = {}) {
  const { user, providerId, connectionId = null, authMethod = null, label = 'Browser setup', newConnection = false, setDefault = false, expiresAt = Date.now() + 600000, check = null } = { ...options, ...selection };
  if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\x00-\x1f\x7f]/.test(label)) throw new CredentialError('invalid-label', 400);
  P.assertName(user);
  if (!P.profileExists(user)) throw new CredentialError('profile-not-found', 404);
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) throw new CredentialError('unknown-provider', 404);
  let connection = connectionId ? C.get(user, providerId, connectionId) : newConnection ? null : C.selected(user, providerId);
  // An explicitly selected different method creates a new connection, never
  // silently overwrites an existing project's key with an organization token.
  if (!connectionId && authMethod && connection?.authMethod !== authMethod) connection = null;
  if (connection && connection.source !== 'sc') throw new CredentialError('external-authorization-required');
  const methods = C.authOptions(provider, 'sc');
  const method = methods.find(m => m.id === (authMethod || connection?.authMethod || methods[0]?.id));
  if (!method || (connection && connection.authMethod !== method.id)) throw new CredentialError('authentication-method-mismatch');
  const variables = provider.vars.filter(v => (method.fields || []).includes(v.key));
  const required = new Set(method.requiredFields || variables.filter(v => v.required).map(v => v.key));
  let used = false, busy = false, attempts = 0;
  const active = () => { if (used || Date.now() >= expiresAt || attempts >= 5) throw new CredentialError('unavailable', 401); };
  const existing = () => {
    if (!connection) return newConnection ? {} : P.readProfile(user);
    const current = C.get(user, providerId, connection.id);
    if (current.source !== 'sc' || current.authMethod !== method.id) throw new CredentialError('connection-changed',409);
    return C.readValues(user, providerId, connection.id);
  };
  function schema() {
    active(); const stored = existing();
    const fields = variables.map(v => {
      const guide = credentialGuide(v.key, { user, override: method.guidance?.[v.key] });
      return { key: v.key, label: v.key, required: required.has(v.key), secret: v.secret !== false, stored: Boolean(stored[v.key]), url: guide.createAt, navigation: guide.navigation, note: guide.note, command: guide.createCommand };
    });
    return { user, provider: providerId, connection: connection?.id || null, label: connection?.label || label, source: 'sc', authMethod: method.id, method: method.id, scope: method.scope || 'account', expiresAt, heading: `${user} — ${provider.title || provider.id} — ${method.label || method.id}`, fields, guidance: fields.map(({ key, url, navigation, note, command }) => ({ key, url, navigation, note, command })) };
  }
  async function save(values, { allowUnverified = false } = {}) {
    active(); if (busy) throw new CredentialError('busy', 409);
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(k => !variables.some(v => v.key === k))) throw new CredentialError('invalid-fields');
    const stored = existing(), updates = {};
    for (const variable of variables) {
      const raw = values[variable.key] ?? '';
      if (typeof raw !== 'string' || raw.length > 4096 || /[\x00-\x1f\x7f]/.test(raw.trim())) throw new CredentialError('invalid-fields');
      const value = raw.trim();
      if (value && variable.validate && !variable.validate(value)) throw new CredentialError('invalid-format');
      if (value) updates[variable.key] = value;
      if (required.has(variable.key) && !(value || stored[variable.key])) throw new CredentialError('required-fields-missing');
    }
    if (!Object.keys(updates).length) throw new CredentialError('enter-at-least-one-value');
    const candidate = Object.fromEntries(variables.filter(v => updates[v.key] || stored[v.key]).map(v => [v.key, updates[v.key] || stored[v.key]]));
    attempts++; busy = true;
    try {
      let verdict;
      try { verdict = await (check || provider.check)?.(candidate); } catch { throw new CredentialError('provider-unavailable'); }
      const verified = verdict?.ok === true;
      if (verdict?.ok === false) throw new CredentialError('rejected');
      if (!verified && !allowUnverified) throw new CredentialError('unverified');
      if (used || Date.now() >= expiresAt) throw new CredentialError('unavailable', 401);
      if (connection) {
        const current = existing();
        if (variables.some(v => current[v.key] !== stored[v.key])) throw new CredentialError('connection-changed',409);
      }
      if (!connection) connection = C.create(user, providerId, { label, source: 'sc', authMethod: method.id, method: method.id, scope: method.scope || 'account', setDefault });
      C.writeValues(user, providerId, connection.id, candidate);
      used = true;
      return { status: verified ? 'verified and saved' : 'stored without live verification', verified, user, provider: providerId, connection: connection.id };
    } finally { busy = false; }
  }
  return { schema, save };
}
module.exports = { CredentialError, createCredentialSession };
