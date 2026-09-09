'use strict';

// Host-neutral plugin-manifest v1 loader. It accepts only declarative metadata
// and package-relative references; hosts decide how (or whether) to execute it.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const MANIFEST_SCHEMA = 'urn:agent-plugin:manifest:v1';
const SENSITIVE_TOKENS = new Set(['secret','token','password','credential','authorization','header','env','command','shell','argv','script']);
const CONTROL = /[\x00-\x1F\x7F]/;
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const MAX_SKILLS = 100;
const MAX_MCP = 20;
function fail(message) { throw new Error(`invalid plugin manifest: ${message}`); }
function own(object, keys) { for (const key of Object.keys(object)) if (!keys.includes(key)) fail(`unknown key ${key}`); }
function cleanString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value || value.length > max || CONTROL.test(value)) fail(`${label} must be a safe string`);
  return value;
}
function relative(value, label) {
  cleanString(value, label, 512);
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)) fail(`${label} must be a safe relative path`);
  return value;
}
function https(value, label) {
  cleanString(value, label, 2048);
  let url; try { url = new URL(value); } catch { fail(`${label} must be an https URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail(`${label} must be a safe https URL`);
  return value;
}
function sensitiveKey(key) {
  const tokens = String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some(token => SENSITIVE_TOKENS.has(token));
}
function scan(value) {
  if (typeof value === 'string' && CONTROL.test(value)) fail('control character');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey(key)) fail(`sensitive or command-like key ${key}`);
    scan(child);
  }
}
function target(base, ref, label) {
  const candidate = path.resolve(base, ref);
  if (!candidate.startsWith(base + path.sep)) fail(`${label} escapes package`);
  let real; try { real = fs.realpathSync(candidate); } catch { fail(`${label} target is missing`); }
  if (!real.startsWith(base + path.sep)) fail(`${label} symlink escapes package`);
  if (!fs.statSync(real).isFile()) fail(`${label} target is not a file`);
  return candidate;
}
function array(value, label, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) fail(`${label} must contain at most ${max} entries`);
  return value;
}
function validateManifest(manifest, options = {}) {
  scan(manifest);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('must be an object');
  own(manifest, ['$schema', 'schemaVersion', 'version', 'id', 'metadata', 'skills', 'mcp']);
  if (manifest.$schema !== undefined && manifest.$schema !== MANIFEST_SCHEMA) fail('$schema');
  if (manifest.schemaVersion !== 1) fail('unsupported schemaVersion');
  cleanString(manifest.version, 'version', 100); if (!VERSION.test(manifest.version)) fail('version');
  cleanString(manifest.id, 'id', 63); if (!ID.test(manifest.id)) fail('id');
  const meta = manifest.metadata;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) fail('metadata');
  own(meta, ['name', 'description', 'homepage']);
  cleanString(meta.name, 'metadata.name', 120); cleanString(meta.description, 'metadata.description');
  if (meta.homepage !== undefined) https(meta.homepage, 'metadata.homepage');
  for (const skill of array(manifest.skills, 'skills', MAX_SKILLS)) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) fail('skill');
    own(skill, ['id', 'path']); cleanString(skill.id, 'skills.id', 63); if (!ID.test(skill.id)) fail('skills.id');
    relative(skill.path, 'skills.path'); if (options.base) target(options.base, skill.path, 'skills.path');
  }
  for (const mcp of array(manifest.mcp, 'mcp', MAX_MCP)) {
    if (!mcp || typeof mcp !== 'object' || Array.isArray(mcp)) fail('mcp');
    own(mcp, ['transport', 'entrypoint', 'catalog', 'endpoint']);
    if (!['stdio', 'https'].includes(mcp.transport)) fail('mcp.transport');
    if (mcp.transport === 'stdio') {
      if (!mcp.entrypoint || !mcp.catalog || mcp.endpoint) fail('stdio MCP requires entrypoint and catalog only');
      relative(mcp.entrypoint, 'mcp.entrypoint'); relative(mcp.catalog, 'mcp.catalog');
      if (options.base) { target(options.base, mcp.entrypoint, 'mcp.entrypoint'); target(options.base, mcp.catalog, 'mcp.catalog'); }
    } else {
      if (!mcp.endpoint || mcp.entrypoint || mcp.catalog) fail('https MCP requires endpoint only');
      https(mcp.endpoint, 'mcp.endpoint');
    }
  }
  return manifest;
}
function loadManifest(file) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(ROOT + path.sep)) fail('manifest outside repository');
  let real; try { real = fs.realpathSync(resolved); } catch { fail('manifest missing'); }
  if (!real.startsWith(ROOT + path.sep)) fail('manifest symlink escapes repository');
  let parsed; try { parsed = JSON.parse(fs.readFileSync(real, 'utf8')); } catch { fail('manifest is not JSON'); }
  return validateManifest(parsed, { base: ROOT });
}
function listPlugins(root = path.join(ROOT, 'plugins')) {
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'mso') continue;
    const file = path.join(root, entry.name, 'plugin.json'); if (!fs.existsSync(file)) continue;
    const plugin = loadManifest(file);
    // Discovery intentionally returns metadata only, never paths, commands, or configuration.
    rows.push(Object.fromEntries(Object.entries({ $schema: plugin.$schema, schemaVersion: plugin.schemaVersion, version: plugin.version, id: plugin.id, metadata: plugin.metadata }).filter(([, value]) => value !== undefined)));
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
module.exports = { MANIFEST_SCHEMA, validateManifest, loadManifest, listPlugins };
