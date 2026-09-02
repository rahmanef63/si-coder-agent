'use strict';

const SECRET_FIELD_RE = /^(value|secret|secretValue|token|tokenValue|accessToken|refreshToken|password|apiKey|apiKeyValue|privateKey|credential|credentialValue)$/i;

const SECRET_PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: 'github-token', re: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{20,}\b/ },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'generic-sk-token', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

function textRisks(text, path = '$') {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) out.push({ path, reason: pattern.id });
  }
  return out;
}

function scanSecretRisks(value, path = '$', seen = new Set()) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return textRisks(value, path);
  if (typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const out = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...scanSecretRisks(item, `${path}[${index}]`, seen)));
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_FIELD_RE.test(key) && typeof child === 'string' && child.trim()) {
      out.push({ path: childPath, reason: 'secret-shaped-field' });
    }
    out.push(...scanSecretRisks(child, childPath, seen));
  }
  return out;
}

function assertNoSecrets(value, label = 'record') {
  const risks = scanSecretRisks(value);
  if (!risks.length) return;
  const summary = risks.slice(0, 4).map(r => `${r.path}:${r.reason}`).join(', ');
  const extra = risks.length > 4 ? ` (+${risks.length - 4} more)` : '';
  throw new Error(`${label} contains secret-shaped content and was not persisted: ${summary}${extra}`);
}

module.exports = {
  SECRET_FIELD_RE,
  SECRET_PATTERNS,
  textRisks,
  scanSecretRisks,
  assertNoSecrets,
};
