// audit.js — metadata-only audit trail for provider/credential lifecycle actions.
// Secret values are never accepted by this module, so they cannot accidentally be logged.
const fs = require('fs');
const path = require('path');
const { AUDIT_FILE, ensureConfigDir } = require(path.resolve(__dirname, 'config'));

function sanitizeMeta(meta = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (/secret|token|password|credential|value/i.test(k) && !/(keyName|credentialKey|secretKeyName)/i.test(k)) continue;
    if (Array.isArray(v)) safe[k] = v.map(x => String(x).slice(0, 200));
    else if (typeof v === 'boolean' || typeof v === 'number') safe[k] = v;
    else safe[k] = String(v).slice(0, 500);
  }
  return safe;
}

function audit(action, meta = {}, file = AUDIT_FILE) {
  ensureConfigDir();
  const row = { ts: new Date().toISOString(), action: String(action), ...sanitizeMeta(meta) };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  return row;
}

function readAudit({ limit = 50, file = AUDIT_FILE } = {}) {
  if (!fs.existsSync(file)) return [];
  const n = Math.max(1, Math.min(500, Number(limit) || 50));
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-n).map(line => {
    try { return JSON.parse(line); } catch { return { ts: null, action: 'invalid-audit-row' }; }
  });
}

module.exports = { audit, readAudit, sanitizeMeta };
