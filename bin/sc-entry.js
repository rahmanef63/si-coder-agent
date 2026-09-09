#!/usr/bin/env node
'use strict';

const SkillStore = require('../lib/skill-store');
const Plugins = require('../lib/plugin-registry');
const SkillCLI = require('../lib/skill-cli');
const { confirm, isInteractive } = require('../lib/prompt');

const { has, value, listValue } = SkillCLI;
function printJson(value_) { process.stdout.write(JSON.stringify(value_, null, 2) + '\n'); }

function printSkill(row, argv) {
  if (has('--json', argv)) return printJson(row);
  console.log(`${row.id}  ${row.scope}  ${row.mutable ? 'mutable' : 'read-only'}`);
  console.log(`path: ${row.path}`);
  console.log(`invoke: ${row.invocation}`);
  if (row.description) console.log(`description: ${row.description}`);
  if (row.tags?.length) console.log(`tags: ${row.tags.join(', ')}`);
  if (row.aliases?.length) console.log(`aliases: ${row.aliases.join(', ')}`);
  if (has('--raw', argv) && row.content) console.log(`\n${row.content}`);
}

async function handleSkill(argv) {
  const sub = argv[1];
  const name = argv[2];
  if (sub === 'list') return SkillCLI.listOrSearch(argv.slice(2), { registryEnvelope: true });
  if (sub === 'search' || sub === 'find') return SkillCLI.listOrSearch(argv.slice(2), { registryEnvelope: true });
  if (sub === 'new') return SkillCLI.createNew(argv.slice(2));
  if (sub === 'show' || sub === 'read' || sub === 'info') {
    if (!name) throw new Error('usage: sc skill show <name|exact-id> [--raw] [--json]');
    return printSkill(SkillStore.showSkill(name, { includeContent: has('--raw', argv) }), argv);
  }
  if (sub === 'create' || sub === 'add') {
    if (!name) throw new Error('usage: sc skill create <name> --description "..." [--scope project|global] [--from-file SKILL.md|--from-dir DIR]');
    const row = SkillStore.createSkill({
      name,
      scope: value('--scope', argv) || 'project',
      description: value('--description', argv),
      fromFile: value('--from-file', argv),
      fromDir: value('--from-dir', argv),
      tags: listValue('--tags', argv),
      aliases: listValue('--aliases', argv),
    });
    if (has('--json', argv)) return printJson(row);
    console.log(`✅ created ${row.id} → ${row.path} · invoke ${row.invocation}`);
    if (row.tags?.length) console.log(`   tags: ${row.tags.join(', ')}`);
    return;
  }
  if (sub === 'update' || sub === 'edit') {
    if (!name) throw new Error('usage: sc skill update <name|exact-id> [--description "..."] [--from-file SKILL.md] [--retag]');
    const row = SkillStore.updateSkill(name, {
      description: value('--description', argv),
      fromFile: value('--from-file', argv),
      tags: listValue('--tags', argv),
      aliases: listValue('--aliases', argv),
      retag: has('--retag', argv),
    });
    if (has('--json', argv)) return printJson(row);
    console.log(`✅ updated ${row.id} → ${row.path}`);
    if (row.tags?.length) console.log(`   tags: ${row.tags.join(', ')}`);
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
  if (argv[0] === 'plugins' || (argv[0] === 'plugin' && argv[1] === 'list')) {
    const rows = Plugins.listPlugins();
    if (has('--json', argv)) return printJson({ version: 1, source: 'si-coder', plugins: rows });
    for (const row of rows) console.log(`${row.id}  ${row.version}  ${row.metadata.description}`);
    return;
  }
  if (argv[0] === 'skills') return SkillCLI.listOrSearch(argv.slice(1), { registryEnvelope: true });
  if (argv[0] === 'skill') return handleSkill(argv);
  // Preserve the mature SC CLI unchanged for providers, users, connections, deploy,
  // update, verification and the Finder TUI.
  require('./sc.js');
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
