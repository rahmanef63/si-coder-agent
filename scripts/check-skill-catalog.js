#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/catalog.json'), 'utf8'));
const rows = catalog.skills || {};
const dirs = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
  .filter(x => x.isDirectory() && fs.existsSync(path.join(ROOT, 'skills', x.name, 'SKILL.md')))
  .map(x => x.name).sort();
const listed = Object.keys(rows).sort();
if (JSON.stringify(dirs) !== JSON.stringify(listed)) throw new Error(`skills/catalog.json drift: dirs=${dirs.join(',')} catalog=${listed.join(',')}`);
for (const [name, row] of Object.entries(rows)) {
  if (!['active','stub','legacy'].includes(row.lifecycle)) throw new Error(`${name}: invalid lifecycle ${row.lifecycle}`);
  if (row.lifecycle !== 'active' && row.installByDefault) throw new Error(`${name}: non-active skill cannot install by default`);
  const text = fs.readFileSync(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
  if (row.lifecycle === 'stub' && !/STUB|NOT IMPLEMENTED/i.test(text)) throw new Error(`${name}: catalog says stub but SKILL.md does not`);
}
const expected = Object.entries(rows).filter(([,row]) => row.lifecycle === 'active' && row.installByDefault).map(([name]) => `./skills/${name}`);
const market = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/marketplace.json'), 'utf8'));
const actual = market.plugins?.find(x => x.name === 'si-coder')?.skills || [];
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Claude marketplace skill list drift\nexpected=${expected.join(',')}\nactual=${actual.join(',')}`);
const installer = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
if (!installer.includes('skills/catalog.json')) throw new Error('install.sh must read skills/catalog.json instead of installing every skill directory');
const generatedPluginDir = path.join(ROOT, 'plugins/si-coder/skills');
if (fs.existsSync(generatedPluginDir)) {
  const generated = fs.readdirSync(generatedPluginDir, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name);
  const inactive = generated.filter(name => rows[name] && rows[name].lifecycle !== 'active');
  if (inactive.length) throw new Error(`generated OpenAI plugin contains non-active skills: ${inactive.join(',')}`);
}
console.log(`skill-catalog=PASS active=${expected.length} total=${listed.length}`);
