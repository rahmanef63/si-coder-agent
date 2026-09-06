'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const CATALOG_PATH = path.join(SKILLS_ROOT, 'catalog.json');
const SAFE_SLASH_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function decodeScalar(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const normalized = text.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return {};
  const out = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    out[match[1]] = decodeScalar(match[2]);
  }
  return out;
}

function catalog() {
  const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return parsed.skills || {};
}

function listSkills(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const rows = [];
  for (const [id, state] of Object.entries(catalog())) {
    const active = state.lifecycle === 'active' && state.installByDefault === true;
    if (!includeInactive && !active) continue;
    const skillPath = path.join(SKILLS_ROOT, id);
    const entry = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(entry)) continue;
    const meta = readFrontmatter(entry);
    const declaredName = SAFE_SLASH_NAME.test(meta.name || '') ? meta.name : id;
    rows.push({
      id,
      name: declaredName,
      description: meta.description || '',
      invocation: `/${declaredName}`,
      lifecycle: state.lifecycle,
      installByDefault: Boolean(state.installByDefault),
      source: 'si-coder',
      path: skillPath,
    });
  }
  return rows;
}

function resolveSkill(name, options = {}) {
  const clean = String(name || '').trim().replace(/^\//, '');
  if (!clean) return null;
  const rows = listSkills(options);
  return rows.find(row => row.name === clean || row.id === clean) || null;
}

module.exports = { listSkills, resolveSkill, readFrontmatter, SAFE_SLASH_NAME };
