'use strict';

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[_/]+/g, ' ').replace(/[^a-z0-9.+#-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenScore(token, candidate) {
  const q = normalize(token).replace(/\s+/g, '');
  const text = normalize(candidate);
  if (!q || !text) return 0;
  if (text === q) return 100;
  if (text.startsWith(q)) return 82;
  if (text.split(/[\s-]+/).includes(q)) return 76;
  if (text.includes(q)) return 58;
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

function queryTokens(query) {
  return String(query || '').trim().split(/\s+/).map(x => x.trim()).filter(Boolean);
}

function scoreText(query, candidate) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 0;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, candidate);
    if (!score) return 0;
    total += score;
  }
  return total;
}

function rankItems(items, query, textFor = item => String(item || '')) {
  if (!String(query || '').trim()) return [...(items || [])];
  return (items || [])
    .map((item, index) => ({ item, index, score: scoreText(query, textFor(item)) }))
    .filter(row => row.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(row => row.item);
}

module.exports = { normalize, tokenScore, queryTokens, scoreText, rankItems };
