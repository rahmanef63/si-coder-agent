'use strict';

const Registry = require('./skill-registry');
const Fuzzy = require('./fuzzy');

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
  const clean = Fuzzy.normalize(token);
  if (!clean) return 0;
  let best = 0;
  if (Fuzzy.normalize(doc.name) === clean || Fuzzy.normalize(doc.invocation).replace(/^\//, '') === clean) best = Math.max(best, 180);
  if (Fuzzy.normalize(doc.name).startsWith(clean)) best = Math.max(best, 135);
  for (const tag of doc.tags) {
    const score = Fuzzy.tokenScore(clean, tag);
    if (score) best = Math.max(best, 95 + Math.min(score, 100));
  }
  for (const alias of doc.aliases) {
    const score = Fuzzy.tokenScore(clean, alias);
    if (score) best = Math.max(best, 80 + Math.min(score, 90));
  }
  const descriptionScore = Fuzzy.tokenScore(clean, doc.description);
  if (descriptionScore) best = Math.max(best, 35 + Math.min(descriptionScore, 75));
  const fullScore = Fuzzy.tokenScore(clean, doc.full);
  if (fullScore) best = Math.max(best, Math.min(fullScore, 60));
  return best;
}

function scoreSkill(row, query) {
  const tokens = Fuzzy.queryTokens(query);
  if (!tokens.length) return { matched: true, score: 0, matchedBy: [] };
  const doc = rowDocument(row);
  let score = 0;
  const matchedBy = [];
  for (const token of tokens) {
    const tokenResult = tokenScore(token, doc);
    if (!tokenResult) return { matched: false, score: 0, matchedBy: [] };
    score += tokenResult;
    if (doc.tags.some(tag => Fuzzy.tokenScore(token, tag) >= 72)) matchedBy.push(`tag:${token}`);
    else if (doc.aliases.some(alias => Fuzzy.tokenScore(token, alias) >= 72)) matchedBy.push(`alias:${token}`);
    else if (Fuzzy.tokenScore(token, doc.name)) matchedBy.push(`name:${token}`);
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
  fuzzyScore: Fuzzy.tokenScore,
  rowDocument,
  tokenScore,
  scoreSkill,
  searchRows,
  searchSkills,
  finderSearchText,
};
