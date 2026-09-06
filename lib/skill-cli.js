'use strict';

const path = require('path');
const Registry = require('./skill-registry');
const Store = require('./skill-store');
const Search = require('./skill-search');
const Meta = require('./skill-metadata');
const { askVisible, selectOne, isInteractive } = require('./prompt');

function has(flag, argv) { return argv.includes(flag); }
function value(flag, argv) {
  const direct = argv.find(arg => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? next : undefined;
}
function listValue(flag, argv) {
  const raw = value(flag, argv);
  return raw ? raw.split(',').map(x => x.trim()).filter(Boolean) : [];
}
function printJson(data) { process.stdout.write(JSON.stringify(data, null, 2) + '\n'); }

function newContract() {
  return {
    version: 1,
    command: 'sc-skill --new',
    purpose: 'Create or install one managed Agent Skill and make it immediately discoverable through the SC registry.',
    required: {
      name: 'Agent Skills-compatible lowercase-hyphen name. May be inferred from --from-file/--from-dir.',
      content: 'Provide --description for a generated scaffold, --from-file SKILL.md, or --from-dir <skill-directory>.',
    },
    optional: {
      scope: 'project (default) or global',
      tags: 'Optional correction only. SC derives tags automatically when omitted.',
      aliases: 'Optional correction only. SC derives aliases automatically when omitted.',
    },
    automatic: [
      'normalize a newly typed name to the Agent Skills lowercase-hyphen convention',
      'derive search tags and aliases from name, description, use_when, and instructions',
      'store discovery data under Agent Skills metadata.sc.* when safe to do so',
      'validate SKILL.md before accepting the skill',
      'copy bundled scripts/references/assets when --from-dir is used',
      'reject symlinks and bounded-install violations in imported skill directories',
      'rollback a failed install instead of leaving a partial skill',
    ],
    examples: [
      'sc-skill --new ui-audit --description "Audit visual UI hierarchy, spacing, typography, responsive states, and design-system consistency."',
      'sc-skill --new --from-dir ./downloaded-skill --scope project',
      'sc-skill --new --from-file ./SKILL.md --scope global',
    ],
    agentInstructions: [
      'Search first with sc-skill <keywords> to avoid duplicate capabilities.',
      'For a remote skill, inspect its SKILL.md and bundled resources, obtain it locally, then install with --from-dir.',
      'Do not manually invent tags unless the automatic metadata is materially wrong.',
      'After installation, verify with sc skill show <name> --json and sc-skill <one expected keyword>.',
    ],
  };
}

function stripOptionArgs(argv) {
  const valueFlags = new Set(['--limit','--scope','--description','--from-file','--from-dir','--tags','--aliases']);
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--') && arg.includes('=')) continue;
    if (valueFlags.has(arg)) { i++; continue; }
    if (arg.startsWith('--')) continue;
    out.push(arg);
  }
  return out;
}

function printRows(rows, options = {}) {
  if (options.json) return printJson({ query: options.query || null, count: rows.length, skills: rows });
  if (!rows.length) {
    console.log(options.query ? `No skills match "${options.query}".` : 'No skills registered.');
    return;
  }
  console.log(options.query ? `\nSkills matching "${options.query}"\n` : '\nSI-Coder skills\n');
  for (const row of rows) {
    const tags = row.tags?.length ? `  #${row.tags.slice(0, 6).join(' #')}` : '';
    const scope = row.scope === 'bundled' ? '' : `  [${row.scope}${row.mutable ? '' : ' · read-only'}]`;
    const score = Number.isFinite(row.score) && options.query ? `  score=${row.score}` : '';
    console.log(`  ${String(row.invocation || '').padEnd(22)} ${row.description || ''}${scope}${score}`);
    if (tags) console.log(`      ${tags.trim()}`);
  }
  console.log('');
}

function listOrSearch(argv = []) {
  const query = stripOptionArgs(argv).join(' ').trim();
  const includeInactive = has('--all', argv);
  const limit = Number(value('--limit', argv) || 25);
  const rows = query
    ? Search.searchSkills(query, { includeInactive, limit })
    : Registry.listSkills({ includeInactive });
  printRows(rows, { query, json: has('--json', argv) });
  return rows;
}

function inferFromSource(argv) {
  const fromDir = value('--from-dir', argv);
  const fromFile = value('--from-file', argv);
  const skillFile = fromDir ? path.join(path.resolve(fromDir), 'SKILL.md') : fromFile ? path.resolve(fromFile) : null;
  if (!skillFile) return {};
  try {
    const meta = Meta.readFrontmatter(skillFile);
    return { name: meta.name || undefined, description: meta.description || undefined };
  } catch {
    return {};
  }
}

async function createNew(argv = []) {
  const inferred = inferFromSource(argv);
  const positionals = stripOptionArgs(argv).filter(x => x !== 'new');
  let name = positionals[0] || inferred.name;
  const fromFile = value('--from-file', argv);
  const fromDir = value('--from-dir', argv);
  let description = value('--description', argv) || inferred.description;
  let scope = value('--scope', argv) || 'project';

  if (!name && !isInteractive()) {
    printJson(newContract());
    return { contractOnly: true };
  }
  if (!name) name = await askVisible('Skill name: ', { escapeCancels: true });
  if (name === null) return { cancelled: true };
  const normalizedName = Meta.specSkillName(name);
  if (!normalizedName) throw new Error('skill name could not be normalized to the Agent Skills naming convention');
  if (!['project','global'].includes(scope)) throw new Error('--scope must be project or global');

  if (!fromFile && !fromDir && !description) {
    if (!isInteractive()) throw new Error('new skill requires --description, --from-file, or --from-dir; run `sc-skill --new` alone for the agent contract');
    description = await askVisible('Description (what it does + when to use it): ', { escapeCancels: true });
    if (description === null) return { cancelled: true };
  }
  if (!value('--scope', argv) && isInteractive() && !fromFile && !fromDir) {
    const picked = await selectOne('Skill scope', [
      { id: 'project', label: 'Project', hint: '.mso/skills · highest normal precedence' },
      { id: 'global', label: 'Global', hint: '~/.mso/skills · reusable across projects' },
    ]);
    if (!picked) return { cancelled: true };
    scope = picked;
  }

  const row = Store.createSkill({
    name: normalizedName,
    description,
    scope,
    fromFile,
    fromDir,
    tags: listValue('--tags', argv),
    aliases: listValue('--aliases', argv),
  });
  if (has('--json', argv)) printJson(row);
  else {
    if (normalizedName !== String(name).trim()) console.log(`normalized name: ${name} → ${normalizedName}`);
    console.log(`created ${row.id} → ${row.path}`);
    console.log(`invoke ${row.invocation}`);
    if (row.tags?.length) console.log(`tags: ${row.tags.join(', ')}`);
  }
  return row;
}

async function handleSkill(argv = [], fallback) {
  const sub = argv[0];
  if (sub === 'list') return listOrSearch(argv.slice(1));
  if (sub === 'search' || sub === 'find') return listOrSearch(argv.slice(1));
  if (sub === 'new') return createNew(argv.slice(1));
  if (typeof fallback === 'function') return fallback();
  throw new Error(`unknown skill command: ${sub || '(none)'}`);
}

async function runStandalone(argv = []) {
  if (!argv.length) return listOrSearch([]);
  if (has('--new', argv)) {
    const filtered = argv.filter(x => x !== '--new');
    return createNew(filtered);
  }
  if (has('--contract', argv)) return printJson(newContract());
  if (argv[0] === 'new') return createNew(argv.slice(1));
  if (argv[0] === 'search' || argv[0] === 'find') return listOrSearch(argv.slice(1));
  return listOrSearch(argv);
}

module.exports = { has, value, listValue, newContract, printRows, listOrSearch, createNew, handleSkill, runStandalone };
