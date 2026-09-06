'use strict';

const fs = require('fs');
const path = require('path');
const Registry = require('./skill-registry');
const Meta = require('./skill-metadata');
const { verifySkill } = require('./agent/skill-verifier');

const MAX_SKILL_BYTES = 256_000;
const MAX_BUNDLE_BYTES = 5_000_000;
const MAX_BUNDLE_FILES = 512;
const VALID_SCOPES = new Set(['project', 'global']);
const SKIP_BUNDLE_DIRS = new Set(['.git', 'node_modules']);

function scopeRoot(scope, options = {}) {
  if (!VALID_SCOPES.has(scope)) throw new Error(`invalid skill scope "${scope}"; expected project or global`);
  const row = Registry.managedRoots(options).find(item => item.scope === scope);
  if (!row) throw new Error(`skill scope root unavailable: ${scope}`);
  return row.root;
}

function assertName(name) {
  const clean = String(name || '').trim().replace(/^\//, '');
  if (!Registry.SAFE_SLASH_NAME.test(clean)) throw new Error('skill name must use letters, numbers, dot, underscore, or dash and may not contain spaces/slashes');
  return clean;
}

function safeTarget(root, name) {
  const target = path.resolve(root, name);
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('unsafe skill path');
  return target;
}

function quote(value) { return JSON.stringify(String(value)); }

function template(name, description) {
  if (!description || !String(description).trim()) throw new Error('--description is required when --from-file/--from-dir is not used');
  const base = `---\nname: ${name}\ndescription: ${quote(description)}\nuse_when: ${quote(`Use when the user explicitly invokes /${name} or the task clearly matches this skill.`)}\ndo_not_use_when: ${quote('Do not use when another more specific skill owns the task or when the requested action is outside this skill scope.')}\nrequired_tools: ""\nsecurity_constraints: ${quote('Never place credentials or secret values in SKILL.md, chat, argv, logs, or tool payloads.')}\nreferences: ""\ncompatibility: ${quote('Agent Skills-compatible hosts; available tools and invocation syntax may vary.')}\n---\n\n# ${name}\n\n## Purpose\n\n${String(description).trim()}\n\n## Instructions\n\n1. Inspect the current project state before changing anything.\n2. Follow the user request and preserve explicit scope locks.\n3. Verify the result before reporting completion.\n`;
  return Meta.ensureAutoMetadata(base, { name, description });
}

function setFrontmatterField(text, key, value) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md must start with YAML frontmatter');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed');
  const lines = normalized.slice(4, end).split('\n');
  const prefix = `${key}:`;
  const next = `${key}: ${quote(value)}`;
  const index = lines.findIndex(line => line.startsWith(prefix));
  if (index >= 0) lines[index] = next;
  else lines.push(next);
  return `---\n${lines.join('\n')}\n---\n${normalized.slice(end + 5)}`;
}

function readSource(file) {
  const resolved = path.resolve(String(file || ''));
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error('--from-file must point to a SKILL.md file');
  if (stat.size > MAX_SKILL_BYTES) throw new Error(`SKILL.md exceeds ${MAX_SKILL_BYTES} bytes`);
  return fs.readFileSync(resolved, 'utf8');
}

function bundleEntries(sourceRoot) {
  const root = path.resolve(String(sourceRoot || ''));
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('--from-dir must point to a real skill directory, not a symlink');
  if (!fs.existsSync(path.join(root, 'SKILL.md'))) throw new Error('--from-dir must contain SKILL.md');
  const rows = [];
  let totalBytes = 0;
  function walk(dir, relativeBase = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_BUNDLE_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.join(relativeBase, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`skill bundle contains unsupported symlink: ${relative}`);
      if (stat.isDirectory()) {
        rows.push({ type: 'dir', absolute, relative });
        if (rows.length > MAX_BUNDLE_FILES) throw new Error(`skill bundle exceeds ${MAX_BUNDLE_FILES} entries`);
        walk(absolute, relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`skill bundle contains unsupported entry: ${relative}`);
      totalBytes += stat.size;
      if (totalBytes > MAX_BUNDLE_BYTES) throw new Error(`skill bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
      rows.push({ type: 'file', absolute, relative, size: stat.size });
      if (rows.length > MAX_BUNDLE_FILES) throw new Error(`skill bundle exceeds ${MAX_BUNDLE_FILES} entries`);
    }
  }
  walk(root);
  return { root, rows, totalBytes };
}

function copyBundle(sourceRoot, targetRoot) {
  const bundle = bundleEntries(sourceRoot);
  for (const row of bundle.rows) {
    const target = path.join(targetRoot, row.relative);
    if (row.type === 'dir') fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(row.absolute, target);
      fs.chmodSync(target, 0o600);
    }
  }
  return bundle;
}

function writeMarker(dir, scope, previous = {}) {
  const now = new Date().toISOString();
  const marker = {
    version: 1,
    managedBy: 'si-coder',
    scope,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  };
  fs.writeFileSync(path.join(dir, '.sc-managed.json'), JSON.stringify(marker, null, 2) + '\n', { mode: 0o600 });
  return marker;
}

function readMarker(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, '.sc-managed.json'), 'utf8')); } catch { return {}; }
}

function validateWritten(file, expectedName, root) {
  const meta = Registry.readFrontmatter(file);
  if (meta.name !== expectedName) throw new Error(`SKILL.md name must remain "${expectedName}"`);
  const result = verifySkill(file, { root, strict: false });
  if (!result.ok) throw new Error(`invalid SKILL.md: ${result.errors.join('; ')}`);
  return result;
}

function createSkill(input = {}, options = {}) {
  const name = assertName(input.name);
  const scope = input.scope || 'project';
  const root = scopeRoot(scope, options);
  const dir = safeTarget(root, name);
  if (fs.existsSync(dir)) throw new Error(`skill already exists in ${scope} scope: ${name}`);
  if (input.fromFile && input.fromDir) throw new Error('choose only one of --from-file or --from-dir');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { recursive: false, mode: 0o700 });
  const file = path.join(dir, 'SKILL.md');
  try {
    if (input.fromDir) copyBundle(input.fromDir, dir);
    let content = input.fromDir
      ? fs.readFileSync(file, 'utf8')
      : input.fromFile
        ? readSource(input.fromFile)
        : template(name, input.description);
    if (input.description && (input.fromFile || input.fromDir)) content = setFrontmatterField(content, 'description', input.description);
    content = Meta.ensureAutoMetadata(content, { name, description: input.description, tags: input.tags, aliases: input.aliases });
    fs.writeFileSync(file, content, { mode: 0o600 });
    validateWritten(file, name, dir);
    writeMarker(dir, scope);
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return Registry.resolveSkill(`${scope}:${name}`, options);
}

function showSkill(query, options = {}) {
  const row = Registry.resolveSkill(query, options);
  if (!row) throw new Error(`unknown skill: ${query}`);
  const result = { ...row };
  if (options.includeContent) result.content = fs.readFileSync(path.join(row.path, 'SKILL.md'), 'utf8');
  return result;
}

function mutableSkill(query, options = {}) {
  const row = Registry.resolveSkill(query, options);
  if (!row) throw new Error(`unknown skill: ${query}`);
  if (row.scope === 'bundled') throw new Error(`bundled skill ${row.name} is read-only; create a project/global override instead`);
  if (!row.mutable) throw new Error(`linked skill ${row.id} is read-only; manage the link with its installer instead`);
  return row;
}

function updateSkill(query, input = {}, options = {}) {
  const row = mutableSkill(query, options);
  const changed = input.fromFile || input.description !== undefined || input.tags?.length || input.aliases?.length || input.retag;
  if (!changed) throw new Error('skill update requires --description, --from-file, --tags, --aliases, or --retag');
  const file = path.join(row.path, 'SKILL.md');
  const previous = fs.readFileSync(file, 'utf8');
  let content = input.fromFile ? readSource(input.fromFile) : previous;
  if (input.description !== undefined) content = setFrontmatterField(content, 'description', input.description);
  content = Meta.ensureAutoMetadata(content, {
    name: row.name,
    description: input.description,
    tags: input.tags,
    aliases: input.aliases,
    retag: Boolean(input.retag || input.description !== undefined || input.fromFile),
  });
  try {
    fs.writeFileSync(file, content, { mode: 0o600 });
    validateWritten(file, row.name, row.path);
    writeMarker(row.path, row.scope, readMarker(row.path));
  } catch (error) {
    fs.writeFileSync(file, previous, { mode: 0o600 });
    throw error;
  }
  return Registry.resolveSkill(row.id, options);
}

function deleteSkill(query, options = {}) {
  const row = mutableSkill(query, options);
  fs.rmSync(row.path, { recursive: true, force: true });
  return { id: row.id, name: row.name, scope: row.scope, deleted: true };
}

module.exports = {
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  scopeRoot,
  bundleEntries,
  copyBundle,
  createSkill,
  showSkill,
  mutableSkill,
  updateSkill,
  deleteSkill,
  setFrontmatterField,
};
