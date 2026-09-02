'use strict';

const fs = require('fs');
const path = require('path');
const { assertNoSecrets } = require('./security');
const { ensureFoundation } = require('./memory-store');
const { slugify, normalizeId, parseDocument, renderDocument } = require('./markdown-record');

const STATES = ['observed', 'repeated', 'candidate', 'verified', 'executable'];

function rootPath(root = process.cwd()) { return path.resolve(root); }
function recipeFile(root, id) { return path.join(rootPath(root), '.agent', 'recipes', `${normalizeId(id)}.md`); }

function readRecipe(id, options = {}) {
  const file = recipeFile(options.root, id);
  if (!fs.existsSync(file)) throw new Error(`recipe ${id} not found`);
  const parsed = parseDocument(fs.readFileSync(file, 'utf8'));
  return { ...parsed.meta, body: parsed.body.trim(), path: file };
}

function deriveState(count, current = null) {
  if (current === 'verified' || current === 'executable') return current;
  if (count >= 3) return 'candidate';
  if (count >= 2) return 'repeated';
  return 'observed';
}

function observeRecipe(name, input = {}, options = {}) {
  ensureFoundation(options.root);
  const id = normalizeId(input.id || slugify(name));
  const file = recipeFile(options.root, id);
  let previous = null;
  if (fs.existsSync(file)) previous = readRecipe(id, options);
  const observedCount = Number(previous?.observed_count || 0) + 1;
  const meta = {
    id,
    name: String(name),
    status: deriveState(observedCount, previous?.status || null),
    observed_count: observedCount,
    last_observed: options.now || new Date().toISOString(),
    scope: String(input.scope || previous?.scope || 'repository'),
    tags: Array.isArray(input.tags) ? input.tags.map(String).slice(0, 32) : (previous?.tags || []),
    steps: Array.isArray(input.steps) && input.steps.length ? input.steps.map(String).filter(Boolean).slice(0, 100) : (previous?.steps || []),
    script: previous?.script || null,
  };
  const body = String(input.body || previous?.body || '').trim();
  assertNoSecrets({ meta, body }, 'recipe');
  fs.writeFileSync(file, renderDocument(meta, body), { encoding: 'utf8', mode: 0o644 });
  return { id, status: meta.status, observedCount, path: file, relativePath: path.relative(rootPath(options.root), file) };
}

function verifyRecipe(id, options = {}) {
  const row = readRecipe(id, options);
  if (!['repeated', 'candidate', 'verified', 'executable'].includes(row.status)) throw new Error(`recipe ${id} must be repeated before verification`);
  if (row.status === 'executable') return { id, status: row.status, script: row.script };
  const meta = { ...row };
  delete meta.body;
  delete meta.path;
  meta.status = 'verified';
  meta.verified_at = options.now || new Date().toISOString();
  assertNoSecrets({ meta, body: row.body }, 'recipe');
  fs.writeFileSync(row.path, renderDocument(meta, row.body), 'utf8');
  return { id, status: 'verified', script: meta.script || null };
}

function promoteRecipe(id, script, options = {}) {
  const row = readRecipe(id, options);
  if (!['verified', 'executable'].includes(row.status)) throw new Error(`recipe ${id} must be verified before promotion`);
  const root = rootPath(options.root);
  const requested = path.resolve(root, script);
  const relative = path.relative(root, requested);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('recipe script must stay inside the repository');
  if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) throw new Error(`recipe script does not exist: ${relative}`);
  const real = fs.realpathSync(requested);
  const realRelative = path.relative(root, real);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw new Error('recipe script symlink escapes the repository');
  const meta = { ...row };
  delete meta.body;
  delete meta.path;
  meta.status = 'executable';
  meta.script = relative.split(path.sep).join('/');
  meta.promoted_at = options.now || new Date().toISOString();
  assertNoSecrets({ meta, body: row.body }, 'recipe');
  fs.writeFileSync(row.path, renderDocument(meta, row.body), 'utf8');
  return { id, status: 'executable', script: meta.script };
}

function listRecipes(options = {}) {
  ensureFoundation(options.root);
  const dir = path.join(rootPath(options.root), '.agent', 'recipes');
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => readRecipe(name.slice(0, -3), options))
    .map(row => ({ id: row.id, name: row.name, status: row.status, observedCount: row.observed_count, script: row.script || null, scope: row.scope, tags: row.tags || [] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { STATES, observeRecipe, verifyRecipe, promoteRecipe, listRecipes, readRecipe };
