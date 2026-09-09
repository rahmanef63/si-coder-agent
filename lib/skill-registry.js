'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const Meta = require('./skill-metadata');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const CATALOG_PATH = path.join(SKILLS_ROOT, 'catalog.json');
const SAFE_SLASH_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const readFrontmatter = Meta.readFrontmatter;

function catalog() {
  const parsed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  return parsed.skills || {};
}

function bundledSkills(options = {}) {
  const includeInactive = Boolean(options.includeInactive);
  const rows = [];
  for (const [id, state] of Object.entries(catalog())) {
    const active = state.lifecycle === 'active' && state.installByDefault === true;
    if (!includeInactive && !active) continue;
    const skillPath = path.join(SKILLS_ROOT, id);
    const entry = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(entry)) continue;
    const discovery = Meta.metadataForSkill(entry, { name: id });
    const meta = discovery.meta;
    const declaredName = SAFE_SLASH_NAME.test(meta.name || '') ? meta.name : id;
    rows.push({
      id,
      name: declaredName,
      description: meta.description || '',
      invocation: `/${declaredName}`,
      lifecycle: state.lifecycle,
      installByDefault: Boolean(state.installByDefault),
      source: 'si-coder',
      scope: 'bundled',
      mutable: false,
      path: skillPath,
      tags: discovery.tags,
      aliases: discovery.aliases,
      tagsSource: discovery.tagsSource,
    });
  }
  return rows;
}

function managedRoots(options = {}) {
  const projectBase = path.resolve(options.projectRoot || process.cwd());
  const explicitGlobal = options.globalRoot || process.env.SC_SKILLS_ROOT || path.join(os.homedir(), '.si-coder', 'skills');
  return [
    { scope: 'project', source: 'project', root: path.join(projectBase, '.si-coder', 'skills') },
    { scope: 'global', source: 'global', root: path.resolve(explicitGlobal) },
  ];
}

function inside(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function listManagedSkills(options = {}) {
  const rows = [];
  for (const rootInfo of managedRoots(options)) {
    let entries = [];
    try { entries = fs.readdirSync(rootInfo.root, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const entryPath = path.join(rootInfo.root, entry.name);
      const skillFile = path.join(entryPath, 'SKILL.md');
      let realPath;
      try {
        const stat = fs.statSync(skillFile);
        if (!stat.isFile() || stat.size > 256_000) continue;
        realPath = fs.realpathSync(entryPath);
      } catch { continue; }

      // install.sh links bundled SC skills into ~/.si-coder/skills. The bundled catalog
      // already represents them, so skip those links to avoid duplicate /sc-* rows.
      if (entry.isSymbolicLink() && inside(SKILLS_ROOT, realPath)) continue;

      const discovery = Meta.metadataForSkill(skillFile, { name: entry.name });
      const meta = discovery.meta;
      const name = SAFE_SLASH_NAME.test(meta.name || '') ? meta.name : entry.name;
      if (!SAFE_SLASH_NAME.test(name)) continue;
      rows.push({
        id: `${rootInfo.scope}:${name}`,
        name,
        description: meta.description || '',
        invocation: `/${name}`,
        lifecycle: 'managed',
        installByDefault: true,
        source: rootInfo.source,
        scope: rootInfo.scope,
        mutable: !entry.isSymbolicLink(),
        path: entryPath,
        tags: discovery.tags,
        aliases: discovery.aliases,
        tagsSource: discovery.tagsSource,
      });
    }
  }
  const rank = { project: 0, global: 1 };
  return rows.sort((a, b) => (rank[a.scope] - rank[b.scope]) || a.name.localeCompare(b.name));
}

function listSkills(options = {}) {
  return [...listManagedSkills(options), ...bundledSkills(options)];
}

function resolveSkill(name, options = {}) {
  const clean = String(name || '').trim().replace(/^\//, '');
  if (!clean) return null;
  const rows = listSkills(options);
  const exact = rows.find(row => row.id === clean);
  if (exact) return exact;
  return rows.find(row => row.name === clean) || null;
}

module.exports = {
  ROOT,
  SKILLS_ROOT,
  SAFE_SLASH_NAME,
  readFrontmatter,
  managedRoots,
  listManagedSkills,
  bundledSkills,
  listSkills,
  resolveSkill,
};
