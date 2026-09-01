// credential-guidance.js — safe, reusable "create here / save here / continue here" metadata.
// Never accepts or returns credential VALUES.
const path = require('path');
const { userCredentialCard, friendlyRecommendation } = require('./user-facing');

function providerRegistry() { return require(path.resolve(__dirname, 'providers')); }

function looksLikeExternalCredential(key) {
  return /(?:^|_)(?:API_KEY|API_TOKEN|ACCESS_TOKEN|DEPLOY_KEY|SECRET_KEY|TOKEN)$/.test(String(key || ''));
}

function credentialGuide(key, { store } = {}) {
  const { SECRET_SOURCES, providerOfVar } = providerRegistry();
  const source = SECRET_SOURCES[key] || {};
  const provider = providerOfVar(key);
  const providerId = provider?.id || null;
  const createAt = source.url || null;
  const createCommand = source.cmd || null;
  const saveWith = providerId ? `sc secret set ${providerId} ${key}` : null;
  const defaultStore = 'active SC profile (~/.config/si-coder/profiles/<name>.env, mode 0600); managed ~/.bashrc only when no SC profile exists';
  const saveDestination = store || defaultStore;
  const continueWith = providerId ? `sc doctor --providers ${providerId}` : null;
  return {
    provider: providerId,
    key,
    secret: source.secret !== false,
    createAt,
    createCommand,
    note: source.note || null,
    saveWith,
    saveDestination,
    continueWith,
    endpointRegistered: Boolean(createAt || createCommand),
    userCard: userCredentialCard({ provider: providerId, createAt, note: source.note || null, saveWith, saveDestination, continueWith }),
  };
}

function humanGuideLines(key, options = {}) {
  const g = credentialGuide(key, options);
  const lines = [];
  if (g.createAt) lines.push(`Create at   : ${g.createAt}`);
  else if (g.createCommand) lines.push(`Get with    : ${g.createCommand}`);
  else if (looksLikeExternalCredential(key)) lines.push('Create at   : endpoint belum terdaftar — tambahkan URL provider sebelum meminta key');
  if (g.note) lines.push(`Instructions: ${g.note}`);
  if (g.saveWith) lines.push(`Save with   : ${g.saveWith}`);
  lines.push(`Stored in   : ${g.saveDestination}`);
  if (g.continueWith) lines.push(`Continue    : ${g.continueWith}`);
  return lines;
}

function recommendation({ next, why, needs = [], action } = {}) {
  const prerequisites = Array.isArray(needs) ? needs : [needs].filter(Boolean);
  const raw = {
    label: '[rekomendasi]',
    next: next || 'continue the previous task',
    why: why || 'make sure the previous step is ready before continuing',
    prerequisites,
    action: action || null,
  };
  return { ...raw, userCard: friendlyRecommendation({ next: raw.next, why: raw.why, prerequisites, action: raw.action }) };
}

module.exports = { looksLikeExternalCredential, credentialGuide, humanGuideLines, recommendation };
