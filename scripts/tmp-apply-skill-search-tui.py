from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path} {label}: expected one match, got {count}')
    p.write_text(text.replace(old, new, 1))

# Auto tags should follow Agent Skills progressive-disclosure metadata, not every incidental
# word in a long instruction body. The body remains available to richer search separately.
replace_once(
    'lib/skill-metadata.js',
    "  const source = normalizeText([input.name, input.description, input.useWhen, input.body].filter(Boolean).join(' '));\n",
    "  const source = normalizeText([input.name, input.description, input.useWhen].filter(Boolean).join(' '));\n",
    'primary tag source',
)
replace_once(
    'lib/skill-metadata.js',
    "  for (const [tag, terms] of TAG_RULES) {\n    if (terms.some(term => source.includes(normalizeText(term)))) tags.push(tag);\n  }\n",
    "  for (const [tag, terms] of TAG_RULES) {\n    if (terms.some(term => source.includes(normalizeText(term)))) tags.push(tag);\n  }\n  // UI/UX/design-system/a11y capabilities are frontend-facing even when the word\n  // \"frontend\" is not repeated in the concise discovery description.\n  if (['ui', 'ux', 'design-system', 'accessibility'].some(tag => tags.includes(tag)) && !tags.includes('frontend')) tags.push('frontend');\n",
    'frontend taxonomy relation',
)

# Explicit/manual metadata must survive ordinary description edits. Auto metadata already
# refreshes itself whenever its source is auto-v1, so --retag remains an explicit override.
replace_once(
    'lib/skill-store.js',
    "    retag: Boolean(input.retag || input.description !== undefined || input.fromFile),\n",
    "    retag: Boolean(input.retag),\n",
    'manual metadata preservation',
)

# Finder-wide fuzzy/multi-token filtering, inspired by fzf/Atuin/Lazygit rather than a
# Skills-only custom filter implementation.
replace_once(
    'lib/finder-tui.js',
    "const readline = require('readline');\n",
    "const readline = require('readline');\nconst Fuzzy = require('./fuzzy');\n",
    'fuzzy import',
)
replace_once(
    'lib/finder-tui.js',
    "    const visible = () => {\n      if (!query) return current.items;\n      const q = query.toLowerCase();\n      return current.items.filter(it => `${it.id} ${stripAnsi(it.label)} ${stripAnsi(it.hint || '')}`.toLowerCase().includes(q));\n    };\n",
    "    const visible = () => Fuzzy.rankItems(\n      current.items,\n      query,\n      it => `${it.id} ${stripAnsi(it.label)} ${stripAnsi(it.hint || '')} ${stripAnsi(it.searchText || '')}`\n    );\n",
    'Finder fuzzy filter',
)

# Skills Finder rows expose rich hidden search text and human-readable tags while sourcing
# everything from the same registry as `sc skills --json`.
replace_once(
    'bin/sc.js',
    "        hint: `${row.scope} · ${row.mutable ? 'editable' : 'read-only'} · ${row.description || 'no description'}`,\n        preview: [\n          `${row.invocation} · ${row.scope} · ${row.mutable ? 'editable' : 'read-only'}`,\n          row.description || 'No description.',\n          `id: ${row.id}`,\n          `path: ${row.path}`,\n        ],\n",
    "        hint: `${row.scope} · ${row.mutable ? 'editable' : 'read-only'} · ${(row.tags || []).slice(0, 4).map(tag => `#${tag}`).join(' ')} · ${row.description || 'no description'}`,\n        searchText: [row.name, row.invocation, row.description, ...(row.tags || []), ...(row.aliases || []), row.scope, row.source].filter(Boolean).join(' '),\n        preview: [\n          `${row.invocation} · ${row.scope} · ${row.mutable ? 'editable' : 'read-only'}`,\n          row.description || 'No description.',\n          `tags: ${(row.tags || []).join(', ') || 'auto-none'}`,\n          `aliases: ${(row.aliases || []).join(', ') || 'none'}`,\n          `id: ${row.id}`,\n          `path: ${row.path}`,\n        ],\n",
    'Skills searchable row',
)
replace_once(
    'bin/sc.js',
    "      { id: 'details', kind: 'action', label: 'Skill details', hint: `${row.invocation} · ${row.scope} · ${row.mutable ? 'editable' : 'read-only'}`, preview: [row.description || 'No description.', `id: ${row.id}`, `path: ${row.path}`] },\n",
    "      { id: 'details', kind: 'action', label: 'Skill details', hint: `${row.invocation} · ${row.scope} · ${row.mutable ? 'editable' : 'read-only'}`, preview: [row.description || 'No description.', `tags: ${(row.tags || []).join(', ') || 'auto-none'}`, `aliases: ${(row.aliases || []).join(', ') || 'none'}`, `id: ${row.id}`, `path: ${row.path}`] },\n",
    'Skill detail preview',
)
replace_once(
    'bin/sc.js',
    "        if (row.description) console.log(`description: ${row.description}`);\n        return;\n",
    "        if (row.description) console.log(`description: ${row.description}`);\n        if (row.tags?.length) console.log(`tags: ${row.tags.join(', ')}`);\n        if (row.aliases?.length) console.log(`aliases: ${row.aliases.join(', ')}`);\n        return;\n",
    'Skill detail action metadata',
)

# Permanent tests: shared fuzzy matcher and TUI must use searchable hidden metadata.
t = Path('test/skill-search.test.js')
ts = t.read_text()
append = r'''

test('SKSEARCH-7: shared Finder fuzzy matcher supports multi-token and typo-tolerant discovery', () => {
  const Fuzzy = require('../lib/fuzzy');
  const items = [
    { id: 'ui', searchText: 'ui interface visual frontend design-system accessibility' },
    { id: 'deploy', searchText: 'deployment production hosting dokploy' },
  ];
  const interfaceHit = Fuzzy.rankItems(items, 'interfce', item => item.searchText);
  assert.equal(interfaceHit[0]?.id, 'ui');
  const multi = Fuzzy.rankItems(items, 'visual frontend', item => item.searchText);
  assert.deepEqual(multi.map(item => item.id), ['ui']);
  const finderSource = fs.readFileSync(path.join(ROOT, 'lib', 'finder-tui.js'), 'utf8');
  const scSource = fs.readFileSync(path.join(ROOT, 'bin', 'sc.js'), 'utf8');
  assert.match(finderSource, /Fuzzy\.rankItems/);
  assert.match(finderSource, /it\.searchText/);
  assert.match(scSource, /searchText: \[row\.name, row\.invocation, row\.description/);
});

test('SKSEARCH-8: manual tags survive description edits while auto tags refresh', () => {
  const projectRoot = tmp();
  const options = { projectRoot, globalRoot: path.join(projectRoot, 'global') };
  let row = Store.createSkill({ name: 'manual-meta', description: 'A UI audit helper.', scope: 'project', tags: ['custom-taxonomy'], aliases: ['special-ui'] }, options);
  row = Store.updateSkill(row.id, { description: 'A database audit helper.' }, options);
  assert.deepEqual(row.tags, ['custom-taxonomy']);
  assert.deepEqual(row.aliases, ['special-ui']);

  let auto = Store.createSkill({ name: 'auto-meta', description: 'A UI audit helper.', scope: 'project' }, options);
  assert.ok(auto.tags.includes('ui'));
  auto = Store.updateSkill(auto.id, { description: 'A database schema migration helper.' }, options);
  assert.ok(auto.tags.includes('database'));
  assert.ok(!auto.tags.includes('ui'));
});
'''
if 'SKSEARCH-7:' not in ts:
    t.write_text(ts + append)
