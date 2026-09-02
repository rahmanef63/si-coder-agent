'use strict';

const fs = require('fs');
const path = require('path');
const { assertNoSecrets } = require('./security');
const { slugify, normalizeId, parseDocument, renderDocument } = require('./markdown-record');

const TYPES = ['task', 'debug', 'test', 'decision', 'failure'];
const TYPE_DIR = { task: 'tasks', debug: 'debug', test: 'tests', decision: 'decisions', failure: 'failures' };
const STATUSES = ['active', 'confirmed', 'superseded', 'archived'];
const FOUNDATION_DIRS = [
  '.agent/memory/tasks',
  '.agent/memory/debug',
  '.agent/memory/tests',
  '.agent/memory/decisions',
  '.agent/memory/failures',
  '.agent/recipes',
  '.agent/scripts',
  '.agent/evidence',
];

function rootPath(root = process.cwd()) { return path.resolve(root); }
function agentPath(root = process.cwd()) { return path.join(rootPath(root), '.agent'); }

function ensureFoundation(root = process.cwd()) {
  const base = rootPath(root);
  for (const rel of FOUNDATION_DIRS) fs.mkdirSync(path.join(base, rel), { recursive: true, mode: 0o755 });
  return { root: base, agentDir: path.join(base, '.agent'), directories: [...FOUNDATION_DIRS] };
}

function validateType(type) {
  if (!TYPES.includes(type)) throw new Error(`invalid memory type ${JSON.stringify(type)}; expected ${TYPES.join(' | ')}`);
  return type;
}

function validateStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`invalid memory status ${JSON.stringify(status)}; expected ${STATUSES.join(' | ')}`);
  return status;
}

function confidenceValue(value, fallback = 0.8) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error('confidence must be between 0 and 1');
  return n;
}

function iso(value, fallback = null) {
  if (!value && fallback) return fallback;
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date ${JSON.stringify(value)}`);
  return d.toISOString();
}

function canonicalRecord(type, input = {}, options = {}) {
  validateType(type);
  const now = options.now || new Date().toISOString();
  const title = String(input.title || input.target || input.issue || `${type} memory`).trim();
  if (!title) throw new Error('memory title is required');
  const id = normalizeId(input.id || `${type}-${slugify(title)}`);
  const status = validateStatus(input.status || (type === 'test' && String(input.result || '').toLowerCase() === 'pass' ? 'confirmed' : 'active'));
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean).slice(0, 32) : [];
  const relatedAreas = Array.isArray(input.relatedAreas || input.related_areas)
    ? (input.relatedAreas || input.related_areas).map(String).filter(Boolean).slice(0, 32)
    : [];
  const record = {
    id,
    type,
    title,
    status,
    confidence: confidenceValue(input.confidence, type === 'test' && String(input.result || '').toLowerCase() === 'pass' ? 1 : 0.8),
    scope: String(input.scope || 'repository'),
    tags,
    commit: input.commit ? String(input.commit) : null,
    supersedes: input.supersedes ? String(input.supersedes) : null,
    created_at: iso(input.createdAt || input.created_at, now),
    last_verified: iso(input.lastVerified || input.last_verified, type === 'test' ? now : null),
  };

  if (type === 'test') {
    const required = ['target', 'source', 'environment', 'expected', 'actual', 'result'];
    for (const key of required) {
      if (input[key] === undefined || input[key] === null || input[key] === '') throw new Error(`test memory requires ${key}`);
    }
    record.target = String(input.target);
    record.source = String(input.source);
    record.environment = String(input.environment);
    record.steps = Array.isArray(input.steps) ? input.steps.map(String).slice(0, 100) : [String(input.steps || '')].filter(Boolean);
    record.expected = typeof input.expected === 'string' ? input.expected : JSON.stringify(input.expected);
    record.actual = typeof input.actual === 'string' ? input.actual : JSON.stringify(input.actual);
    record.result = String(input.result);
    record.related_areas = relatedAreas;
  } else if (relatedAreas.length) {
    record.related_areas = relatedAreas;
  }

  if (input.issue) record.issue = String(input.issue);
  if (input.rootCause || input.root_cause) record.root_cause = String(input.rootCause || input.root_cause);
  if (input.fix) record.fix = String(input.fix);
  if (input.symptoms) record.symptoms = Array.isArray(input.symptoms) ? input.symptoms.map(String).slice(0, 50) : [String(input.symptoms)];
  if (input.failedAttempts || input.failed_attempts) record.failed_attempts = Array.isArray(input.failedAttempts || input.failed_attempts) ? (input.failedAttempts || input.failed_attempts).map(String).slice(0, 50) : [String(input.failedAttempts || input.failed_attempts)];
  if (input.verification) record.verification = Array.isArray(input.verification) ? input.verification.map(String).slice(0, 50) : [String(input.verification)];
  if (input.source && type !== 'test') record.source = String(input.source);
  if (input.decision) record.decision = String(input.decision);
  if (input.result && type !== 'test') record.result = String(input.result);

  const body = String(input.body || '').trim();
  assertNoSecrets({ record, body }, 'memory');
  return { record, body };
}

function memoryFile(root, type, id) {
  return path.join(agentPath(root), 'memory', TYPE_DIR[validateType(type)], `${normalizeId(id)}.md`);
}

function writeMemory(type, input = {}, options = {}) {
  ensureFoundation(options.root);
  const { record, body } = canonicalRecord(type, input, options);
  const file = memoryFile(options.root, type, record.id);
  if (fs.existsSync(file) && options.replace === false) throw new Error(`memory ${record.id} already exists`);
  fs.writeFileSync(file, renderDocument(record, body), { encoding: 'utf8', mode: 0o644 });
  return { id: record.id, type, status: record.status, path: file, relativePath: path.relative(rootPath(options.root), file), record };
}

function readMemoryFile(file) {
  const parsed = parseDocument(fs.readFileSync(file, 'utf8'));
  return { ...parsed.meta, body: parsed.body.trim(), path: file };
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function listMemory(options = {}) {
  ensureFoundation(options.root);
  const base = path.join(agentPath(options.root), 'memory');
  return listFilesRecursive(base)
    .map(readMemoryFile)
    .filter(r => !options.type || r.type === options.type)
    .filter(r => !options.status || r.status === options.status)
    .filter(r => options.includeArchived || r.status !== 'archived')
    .sort((a, b) => String(b.last_verified || b.created_at || '').localeCompare(String(a.last_verified || a.created_at || '')));
}

function tokens(query) {
  return String(query || '').toLowerCase().split(/[^a-z0-9._-]+/).filter(x => x.length > 1).slice(0, 24);
}

function freshness(record, staleAfterDays = 90, now = Date.now()) {
  const raw = record.last_verified || record.created_at || null;
  if (!raw) return { ageDays: null, stale: true };
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return { ageDays: null, stale: true };
  const ageDays = Math.max(0, (now - t) / 86400000);
  return { ageDays: Number(ageDays.toFixed(1)), stale: ageDays > staleAfterDays };
}

function scoreRecord(record, queryTokens, tags = [], scope = null, stale = false) {
  const haystack = [record.title, record.type, record.status, record.scope, record.tags, record.related_areas, record.target, record.issue, record.root_cause, record.fix, record.symptoms, record.failed_attempts, record.verification, record.body]
    .flat().filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (String(record.title || '').toLowerCase().includes(token)) score += 6;
    else if (haystack.includes(token)) score += 2;
  }
  for (const tag of tags) if ((record.tags || []).includes(tag)) score += 4;
  if (scope && record.scope === scope) score += 3;
  if (record.status === 'confirmed') score += 2;
  if (record.status === 'superseded') score -= 8;
  if (record.status === 'archived') score -= 12;
  if (stale) score -= 6;
  score += Number(record.confidence || 0);
  return score;
}

function compactRecord(record, score, fresh) {
  const body = String(record.body || '').replace(/\s+/g, ' ').trim();
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    status: record.status,
    confidence: record.confidence,
    scope: record.scope,
    tags: record.tags || [],
    commit: record.commit || null,
    lastVerified: record.last_verified || null,
    ageDays: fresh.ageDays,
    stale: fresh.stale,
    score: Number(score.toFixed(3)),
    excerpt: body.slice(0, 360),
  };
}

function queryMemory(input = {}, options = {}) {
  const queryTokens = tokens(input.query);
  const requestedTags = Array.isArray(input.tags) ? input.tags.map(String) : [];
  const staleAfterDays = Math.max(1, Math.min(Number(input.staleAfterDays) || 90, 3650));
  const rows = listMemory({
    root: options.root,
    type: input.type || null,
    status: input.status || null,
    includeArchived: Boolean(input.includeArchived),
  });
  const ranked = rows
    .map(record => {
      const fresh = freshness(record, staleAfterDays, options.now ? new Date(options.now).getTime() : Date.now());
      return { record, fresh, score: scoreRecord(record, queryTokens, requestedTags, input.scope || null, fresh.stale) };
    })
    .filter(x => !input.freshOnly || !x.fresh.stale)
    .filter(x => !queryTokens.length || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(Number(input.limit) || 5, 20)))
    .map(x => compactRecord(x.record, x.score, x.fresh));
  return {
    query: String(input.query || ''),
    filters: { type: input.type || null, status: input.status || null, scope: input.scope || null, tags: requestedTags, staleAfterDays, freshOnly: Boolean(input.freshOnly) },
    count: ranked.length,
    memories: ranked,
    context: ranked.map(r => `[${r.type}/${r.status}${r.stale ? '/STALE' : ''}] ${r.title}${r.excerpt ? ` — ${r.excerpt}` : ''}`).join('\n').slice(0, Number(input.maxChars) || 4000),
  };
}

function findMemory(root, id) {
  const rows = listMemory({ root, includeArchived: true });
  const matches = rows.filter(r => r.id === id);
  if (!matches.length) throw new Error(`memory ${id} not found`);
  if (matches.length > 1) throw new Error(`memory id ${id} is ambiguous`);
  return matches[0];
}

function setMemoryStatus(id, status, options = {}) {
  validateStatus(status);
  const row = findMemory(options.root, id);
  const meta = { ...row };
  delete meta.body;
  delete meta.path;
  meta.status = status;
  if (options.lastVerified) meta.last_verified = iso(options.lastVerified);
  if (options.supersedes !== undefined) meta.supersedes = options.supersedes || null;
  assertNoSecrets({ meta, body: row.body }, 'memory');
  fs.writeFileSync(row.path, renderDocument(meta, row.body), 'utf8');
  return { id, status, path: row.path };
}

module.exports = {
  TYPES,
  STATUSES,
  FOUNDATION_DIRS,
  ensureFoundation,
  canonicalRecord,
  writeMemory,
  listMemory,
  queryMemory,
  freshness,
  setMemoryStatus,
  memoryFile,
};
