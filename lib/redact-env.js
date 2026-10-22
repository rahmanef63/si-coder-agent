'use strict';
// Scrub literal secret values (taken from secret-named env vars) out of text before it
// leaves the process boundary, e.g. child stdout/stderr relayed to an MCP client.
const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|DEPLOY_KEY|PRIVATE_KEY|_PAT$|^GH_PAT|COMPOSIO_KEY|(?:^|_)O?AUTH(?:_|$))/i;
const MIN_LEN = 8;

function secretValues(env = process.env) {
  const vals = new Set();
  for (const [k, v] of Object.entries(env || {})) {
    if (typeof v === 'string' && v.length >= MIN_LEN && SECRET_NAME.test(k)) vals.add(v);
  }
  // Longest first so a secret containing another secret is fully replaced.
  return [...vals].sort((a, b) => b.length - a.length);
}

// Shape-based patterns (adopted from connectors-gateway adapters/remote-mcp/src/redact.ts):
// catch credentials that are NOT in env (read from a file, echoed by an upstream 401, typed in).
// Deliberately omits the gateway's generic "any 24+ char run" rule: SC output carries commit
// SHAs, deployment IDs and Convex/Vercel IDs that agents need to see.
const TOKEN_PATTERNS = [
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]'],
  [/\b((?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|apikey|password|passwd|secret|token|authorization)["']?\s*[:=]\s*["']?)[^\s"',;&]{8,}/gi, '$1[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]'],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted]'],
  [/\bre_[A-Za-z0-9]{16,}_[A-Za-z0-9]{8,}\b/g, '[redacted]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, '[redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[redacted]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted]'],
];

function scrubPatterns(text) {
  let out = text;
  for (const [re, rep] of TOKEN_PATTERNS) out = out.replace(re, rep);
  return out;
}

function scrubSecrets(text, env = process.env) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const v of secretValues(env)) out = out.split(v).join('[redacted]');
  return scrubPatterns(out);
}

function scrubDeep(value, env = process.env, depth = 0) {
  if (depth > 32) return value;
  if (typeof value === 'string') return scrubSecrets(value, env);
  if (Array.isArray(value)) return value.map(x => scrubDeep(x, env, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, scrubDeep(x, env, depth + 1)]));
  }
  return value;
}

module.exports = { scrubSecrets, scrubPatterns, TOKEN_PATTERNS, scrubDeep, secretValues, SECRET_NAME };
