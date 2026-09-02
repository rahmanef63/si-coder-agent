'use strict';

function slugify(value) {
  const slug = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'record';
}

function normalizeId(value) {
  const id = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(id)) throw new Error(`invalid record id ${JSON.stringify(value)}`);
  return id;
}

function serializeFrontmatter(meta) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function parseScalar(raw) {
  const value = raw.trim();
  try { return JSON.parse(value); } catch { return value; }
}

function parseDocument(content) {
  if (typeof content !== 'string' || !content.startsWith('---\n')) return { meta: {}, body: content || '' };
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return { meta: {}, body: content };
  const block = content.slice(4, end);
  const meta = {};
  for (const line of block.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    meta[line.slice(0, idx).trim()] = parseScalar(line.slice(idx + 1));
  }
  return { meta, body: content.slice(end + 5) };
}

function renderDocument(meta, body = '') {
  return `${serializeFrontmatter(meta)}\n${String(body || '').replace(/^\s+/, '')}`.replace(/\s*$/, '\n');
}

module.exports = { slugify, normalizeId, serializeFrontmatter, parseDocument, renderDocument };
