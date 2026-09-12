'use strict';

const fs = require('fs');
const path = require('path');
const { assertAllowedUses } = require('./security');

const ROOT = path.resolve(__dirname, '../..');
const PACKAGED_DIR = path.join(ROOT, 'flows');

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function validateFlow(doc) {
  if (!isPlainObject(doc)) throw new Error('flow document must be a JSON object');
  if (typeof doc.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(doc.id)) {
    throw new Error('flow.id is required and must be a safe identifier');
  }
  if (doc.title !== undefined && typeof doc.title !== 'string') throw new Error('flow.title must be a string');
  if (doc.description !== undefined && typeof doc.description !== 'string') throw new Error('flow.description must be a string');
  if (doc.props !== undefined) {
    if (!isPlainObject(doc.props)) throw new Error('flow.props must be a JSON Schema object when present');
    if (doc.props.type !== undefined && doc.props.type !== 'object') {
      throw new Error('flow.props.type must be "object" when present');
    }
  }
  if (!Array.isArray(doc.steps) || !doc.steps.length) throw new Error('flow.steps must be a non-empty array');

  const ids = new Set();
  for (const [index, step] of doc.steps.entries()) {
    if (!isPlainObject(step)) throw new Error(`steps[${index}] must be an object`);
    if (typeof step.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(step.id)) {
      throw new Error(`steps[${index}].id is required and must be a safe identifier`);
    }
    if (ids.has(step.id)) throw new Error(`duplicate step id: ${step.id}`);
    ids.add(step.id);
    assertAllowedUses(step.uses);
    if (step.with !== undefined && !isPlainObject(step.with)) throw new Error(`steps[${index}].with must be an object`);
    if (step.needs !== undefined) {
      if (!Array.isArray(step.needs) || step.needs.some(x => typeof x !== 'string')) {
        throw new Error(`steps[${index}].needs must be a string array`);
      }
    }
    if (step.when !== undefined && typeof step.when !== 'string') {
      throw new Error(`steps[${index}].when must be a string template when present`);
    }
    if (step.continueOnError !== undefined && typeof step.continueOnError !== 'boolean') {
      throw new Error(`steps[${index}].continueOnError must be a boolean`);
    }
  }

  for (const step of doc.steps) {
    for (const need of step.needs || []) {
      if (!ids.has(need)) throw new Error(`step ${step.id} needs unknown step "${need}"`);
      if (need === step.id) throw new Error(`step ${step.id} cannot need itself`);
    }
  }

  // Detect cycles via DFS
  const byId = new Map(doc.steps.map(s => [s.id, s]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`flow has a cycle involving step "${id}"`);
    visiting.add(id);
    for (const need of byId.get(id).needs || []) visit(need);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);

  return doc;
}

function readFlowFile(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`flow file not found: ${abs}`);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { throw new Error(`invalid flow JSON ${abs}: ${e.message}`); }
  validateFlow(doc);
  return { ...doc, _source: abs };
}

function listFlowFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(dir, name))
    .sort();
}

function discoverDirs(root = process.cwd()) {
  const dirs = [PACKAGED_DIR];
  const projectDir = path.join(path.resolve(root), '.si-coder', 'flows');
  if (projectDir !== PACKAGED_DIR) dirs.push(projectDir);
  return dirs;
}

function listFlows({ root = process.cwd() } = {}) {
  const seen = new Map();
  for (const dir of discoverDirs(root)) {
    for (const file of listFlowFiles(dir)) {
      try {
        const doc = readFlowFile(file);
        // Project flows override packaged flows with the same id.
        seen.set(doc.id, {
          id: doc.id,
          title: doc.title || null,
          description: doc.description || null,
          path: doc._source,
          stepCount: doc.steps.length,
        });
      } catch {
        // Skip invalid discovery candidates; load/validate surfaces errors explicitly.
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function loadFlow(idOrPath, { root = process.cwd() } = {}) {
  if (typeof idOrPath !== 'string' || !idOrPath.trim()) throw new Error('flow id or path is required');
  const raw = idOrPath.trim();

  if (raw.endsWith('.json') || raw.includes('/') || raw.includes(path.sep) || raw.startsWith('.')) {
    return readFlowFile(path.isAbsolute(raw) ? raw : path.resolve(root, raw));
  }

  // Prefer project overlay, then packaged.
  const candidates = [];
  for (const dir of discoverDirs(root).reverse()) {
    candidates.push(path.join(dir, `${raw}.json`));
  }
  // Also allow matching by id inside listed files (filename may differ).
  for (const dir of discoverDirs(root).reverse()) {
    for (const file of listFlowFiles(dir)) {
      try {
        const doc = readFlowFile(file);
        if (doc.id === raw) return doc;
      } catch { /* ignore */ }
    }
  }
  for (const file of candidates) {
    if (fs.existsSync(file)) return readFlowFile(file);
  }
  throw new Error(`flow not found: ${raw}`);
}

module.exports = {
  ROOT,
  PACKAGED_DIR,
  validateFlow,
  listFlows,
  loadFlow,
};
