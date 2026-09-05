'use strict';
const crypto = require('node:crypto');
const P = require('./profiles');
const C = require('./connections');
const { PROVIDERS } = require('./providers');
const { credentialGuide } = require('./credential-guidance');
class CredentialError extends Error { constructor(code, status = 400) { super(code); this.status = status; } }
function createCredentialSession(selection, { check = null, expiresAt = Date.now() + 600000 } = {}) {
  const { user, providerId, connectionId, authMethod, newConnection = false, label = 'Browser setup' } = selection;
  if (typeof user !== 'string' || !P.profileExists(user)) throw new CredentialError('unknown_user');
  const provider = PROVIDERS.find(p => p.id === providerId);
  if (!provider) throw new CredentialError('unknown_provider');
  let connection = newConnection ? null : C.selected(user, providerId, connectionId || null);
  const source = connection?.source || selection.source || 'sc';
  const methods = C.authOptions(provider, source);
  const method = C.authOption(provider, source, authMethod || connection?.authMethod || methods[0]?.id);
  if (connection && (connection.authMethod !== method.id || connection.source !== source)) throw new CredentialError('method_mismatch');
  if (typeof label !== 'string' || !label.trim() || label.length > 120 || /[\x00-\x1f\x7f]/.test(label)) throw new CredentialError('invalid_label');
  const fields = (source === 'sc' ? provider.vars.filter(v => (method.fields || []).includes(v.key)) : []);
  const required = new Set(method.requiredFields || fields.filter(v => v.required).map(v => v.key));
  let used = false, busy = false, attempts = 0;
  const active = () => { if (used || Date.now() >= expiresAt || attempts >= 5) throw new CredentialError('session_expired', 401); };
  const existing = () => {
    if (!connection) return newConnection ? {} : P.readProfile(user);
    const current = C.get(user, providerId, connection.id);
    if (current.authMethod !== method.id || current.source !== source) throw new CredentialError('connection_changed', 409);
    return source === 'sc' ? C.readValues(user, providerId, current.id) : {};
  };
  function schema() {
    active(); const values = existing();
    return { user, provider: providerId, title: provider.title, connection: connection?.id || null, label: connection?.label || label,
      source, method: method.id, methodLabel: method.label, expiresAt, external: source !== 'sc', verificationAvailable: typeof provider.check === 'function' && provider.status !== 'stub',
      fields: fields.map(v => { const g = credentialGuide(v.key, { override: method.guidance?.[v.key] }); return { key: v.key, secret: v.secret !== false, required: required.has(v.key), stored: Boolean(values[v.key]), guide: { url: g.referenceUrl, navigation: g.navigation, note: g.note } }; }),
      reference: C.sourceOption(provider, source).reference || null,
    };
  }
  async function save(raw, { allowUnverified = false } = {}) {
    active(); if (busy) throw new CredentialError('session_busy', 409);
    if (source !== 'sc') throw new CredentialError('external_authorization_required');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CredentialError('invalid_fields');
    const allowed = new Set(fields.map(v => v.key));
    if (Object.keys(raw).some(key => !allowed.has(key))) throw new CredentialError('invalid_fields');
    const current = existing(), updates = {};
    const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(Object.entries(value).sort())).digest('hex');
    const expected = fingerprint(current);
    for (const field of fields) {
      const input = raw[field.key] ?? '';
      if (typeof input !== 'string' || input.length > 4096) throw new CredentialError('invalid_fields');
      const value = input.trim();
      if (/[\x00-\x1f\x7f]/.test(value)) throw new CredentialError('invalid_format');
      if (value && field.validate && !field.validate(value)) throw new CredentialError('invalid_format');
      if (value) updates[field.key] = value;
      if (required.has(field.key) && !value && !current[field.key]) throw new CredentialError('required_fields_missing');
    }
    if (!Object.keys(updates).length) throw new CredentialError('no_changes');
    const values = Object.fromEntries(fields.filter(v => updates[v.key] || current[v.key]).map(v => [v.key, updates[v.key] || current[v.key]]));
    busy = true; attempts++;
    try {
      let verdict; try { verdict = await (check || provider.check)?.(values); } catch { throw new CredentialError('provider_unreachable', 422); }
      if (verdict?.ok === false) throw new CredentialError('credential_rejected', 422);
      if (verdict?.ok !== true && !allowUnverified) throw new CredentialError('verification_unavailable', 422);
      if (Date.now() >= expiresAt) throw new CredentialError('session_expired', 401);
      if (fingerprint(existing()) !== expected) throw new CredentialError('connection_changed', 409); // preserve concurrent rotations
      if (!connection) connection = C.create(user, providerId, { label: label.trim(), source, authMethod: method.id, scope: method.scope, setDefault: false });
      C.writeValues(user, providerId, connection.id, values); used = true;
      return { ok: true, verified: verdict?.ok === true, connection: connection.id, status: verdict?.ok === true ? 'verified_and_saved' : 'saved_unverified' };
    } finally { busy = false; }
  }
  return { schema, save };
}
module.exports = { createCredentialSession, CredentialError };
