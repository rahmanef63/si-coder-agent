#!/usr/bin/env node
'use strict';

const { listSkills } = require('../lib/skill-registry');
const SkillStore = require('../lib/skill-store');
const { confirm, isInteractive } = require('../lib/prompt');

function has(flag, argv) { return argv.includes(flag); }
function value(flag, argv) {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const next = argv[index + 1];
  return next && !next.startsWith('--') ? next : undefined;
}
function printJson(value_) { process.stdout.write(JSON.stringify(value_, null, 2) + '\n'); }

function printSkills(argv) {
  const includeInactive = has('--all', argv);
  const rows = listSkills({ includeInactive });
  if (has('--json', argv)) {
    printJson({
      version: 1,
      source: 'si-coder',
      contract: {
        list: '/skills',
        direct: '/<skill> [prompt]',
        exact: '/skill <exact-id> [prompt]',
      },
      skills: rows,
    });
    return;
  }
  console.log('\nSI-Coder skills\n');
  for (const row of rows) {
    let status = '';
    if (row.scope === 'project' || row.scope === 'global') status = ` [${row.scope}${row.mutable ? '' : ' · read-only'}]`;
    else if (row.lifecycle !== 'active' || !row.installByDefault) status = ` [${row.lifecycle}]`;
    console.log(`  ${row.invocation.padEnd(20)} ${row.description}${status}`);
  }
  console.log('\nCRUD managed skills with: sc skill create|show|update|delete ...');
  console.log('Use /<skill> [prompt] in a compatible agent surface.');
  console.log('Use /skills to discover skills, or /skill <exact-id> [prompt] when a host reports ambiguity.\n');
}

function printSkill(row, argv) {
  if (has('--json', argv)) return printJson(row);
  console.log(`${row.id}  ${row.scope}  ${row.mutable ? 'mutable' : 'read-only'}`);
  console.log(`path: ${row.path}`);
  console.log(`invoke: ${row.invocation}`);
  if (row.description) console.log(`description: ${row.description}`);
  if (has('--raw', argv) && row.content) console.log(`\n${row.content}`);
}

async function handleSkill(argv) {
  const sub = argv[1];
  const name = argv[2];
  if (sub === 'list') return printSkills(argv);
  if (sub === 'show' || sub === 'read' || sub === 'info') {
    if (!name) throw new Error('usage: sc skill show <name|exact-id> [--raw] [--json]');
    return printSkill(SkillStore.showSkill(name, { includeContent: has('--raw', argv) }), argv);
  }
  if (sub === 'create' || sub === 'add') {
    if (!name) throw new Error('usage: sc skill create <name> --description "..." [--scope project|global] [--from-file SKILL.md]');
    const row = SkillStore.createSkill({
      name,
      scope: value('--scope', argv) || 'project',
      description: value('--description', argv),
      fromFile: value('--from-file', argv),
    });
    if (has('--json', argv)) return printJson(row);
    console.log(`✅ created ${row.id} → ${row.path} · invoke ${row.invocation}`);
    return;
  }
  if (sub === 'update' || sub === 'edit') {
    if (!name) throw new Error('usage: sc skill update <name|exact-id> [--description "..."] [--from-file SKILL.md]');
    const row = SkillStore.updateSkill(name, {
      description: value('--description', argv),
      fromFile: value('--from-file', argv),
    });
    if (has('--json', argv)) return printJson(row);
    console.log(`✅ updated ${row.id} → ${row.path}`);
    return;
  }
  if (sub === 'delete' || sub === 'rm' || sub === 'remove') {
    if (!name) throw new Error('usage: sc skill delete <name|exact-id> --yes');
    const target = SkillStore.mutableSkill(name);
    if (!has('--yes', argv)) {
      if (!isInteractive()) throw new Error('refusing to delete a managed skill without --yes on a non-TTY');
      if (!await confirm(`Delete managed skill "${target.id}" and its directory?`)) {
        console.log('aborted');
        return;
      }
    }
    const out = SkillStore.deleteSkill(target.id);
    if (has('--json', argv)) return printJson(out);
    console.log(`✅ deleted ${out.id}`);
    return;
  }
  // sc skill verify and any future mature skill subcommands remain owned by bin/sc.js.
  require('./sc.js');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'skills') return printSkills(argv);
  if (argv[0] === 'skill') return handleSkill(argv);
  // Preserve the mature SC CLI unchanged for providers, users, connections, deploy,
  // update, verification and the Finder TUI.
  require('./sc.js');
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
