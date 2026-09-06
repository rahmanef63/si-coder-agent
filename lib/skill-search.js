'use strict';

const Registry = require('./skill-registry');
const Meta = require('./skill-metadata');

function fuzzyScore(token, candidate) {
  const q = Meta.normalizeText(token).replace(/\s+/g, '');
  const text = Meta.normalizeText(candidate);
  if (!q || !text) return 0;
  if (text === q) return 100;
  if (text.startsWith(q)) return 80;
  if (text.split(/[\s-]+/).includes(q)) return 72;
  if (text.includes(q)) return 55;
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (text[i] !== q[qi]) continue;
    score += (i === 0 || /[\s._/-]/.test(text[i - 1] || '')) ? 8 : 3;
    if (i === last + 1) score += 2;
    last = i;
    qi++;
  }
  if (qi !== q.length) return 0;
  return Math.max(10, score - Math.min(20, text.length - q.length));
}

function rowDocument(row) {
  const tags = Array.isArray(row.tags) ? row.tags : [];
  const aliases = Array.isArray(row.aliases) ? row.aliases : [];
  return {
    name: row.name || '',
    invocation: row.invocation || '',
    description: row.description || '',
    tags,
    aliases,
    scope: row.scope || '',
    source: row.source || '',
    path: row.path || '',
    full: [row.name, row.invocation, row.description, tags.join(' '), aliases.join(' '), row.scope, row.source, row.path]
      .filter(Boolean).join(' '),
  };
}

function tokenScore(token, doc) {
  const clean = Meta.normalizeText(token);
  if (!clean) return 0;
  let best = 0;
  if (Meta.normalizeText(doc.name) === clean || Meta.normalizeText(doc.invocation).replace(/^\//, '') === clean) best = Math.max(best, 180);
  if (Meta.normalizeText(doc.name).startsWith(clean)) best = Math.max(best, 135);
  for (const tag of doc.tags) {
    const score = fuzzyScore(clean, tag);
    if (score) best = Math.max(best, 95 + Math.min(score, 100));
  }
  for (const alias of doc.aliases) {
    const score = fuzzyScore(clean, alias);
    if (score) best = Math.max(best, 80 + Math.min(score, 90));
  }
  const descriptionScore = fuzzyScore(clean, doc.description);
  if (descriptionScore) best = Math.max(best, 35 + Math.min(descriptionScore, 75));
  const fullScore = fuzzyScore(clean, doc.full);
  if (fullScore) best = Math.max(best, Math.min(fullScore, 60));
  return best;
}

function tokenizeQuery(query) {
  return String(query || '').trim().split(/\s+/).map(x => x.trim()).filter(Boolean);
}

function scoreSkill(row, query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return { matched: true, score: 0, matchedBy: [] };
  const doc = rowDocument(row);
  let score = 0;
  const matchedBy = [];
  for (const token of tokens) {
    const tokenResult = tokenScore(token, doc);
    if (!tokenResult) return { matched: false, score: 0, matchedBy: [] };
    score += tokenResult;
    if (doc.tags.some(tag => fuzzyScore(token, tag) >= 72)) matchedBy.push(`tag:${token}`);
    else if (doc.aliases.some(alias => fuzzyScore(token, alias) >= 72)) matchedBy.push(`alias:${token}`);
    else if (fuzzyScore(token, doc.name)) matchedBy.push(`name:${token}`);
    else matchedBy.push(`text:${token}`);
  }
  const scopeBoost = { project: 8, global: 4, bundled: 1 }[row.scope] || 0;
  return { matched: true, score: score + scopeBoost, matchedBy };
}

function searchRows(rows, query, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const out = [];
  for (const row of rows || []) {
    const result = scoreSkill(row, query);
    if (!result.matched) continue;
    out.push({ ...row, score: result.score, matchedBy: result.matchedBy });
  }
  return out.sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name)).slice(0, limit);
}

function searchSkills(query, options = {}) {
  const rows = Registry.listSkills({ ...options, includeInactive: Boolean(options.includeInactive) });
  return searchRows(rows, query, options);
}

function finderSearchText(row) {
  const doc = rowDocument(row);
  return [doc.name, doc.invocation, doc.description, ...doc.tags, ...doc.aliases, doc.scope, doc.source].filter(Boolean).join(' ');
}

module.exports = {
  fuzzyScore,
  rowDocument,
  tokenScore,
  scoreSkill,
  searchRows,
  searchSkills,
  finderSearchText,
};
