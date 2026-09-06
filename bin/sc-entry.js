#!/usr/bin/env node
'use strict';

const { listSkills } = require('../lib/skill-registry');

function has(flag, argv) { return argv.includes(flag); }

function printSkills(argv) {
  const includeInactive = has('--all', argv);
  const rows = listSkills({ includeInactive });
  if (has('--json', argv)) {
    process.stdout.write(JSON.stringify({
      version: 1,
      source: 'si-coder',
      contract: {
        list: '/skills',
        direct: '/<skill> [prompt]',
        exact: '/skill <exact-id> [prompt]',
      },
      skills: rows,
    }, null, 2) + '\n');
    return;
  }
  console.log('\nSI-Coder skills\n');
  for (const row of rows) {
    const status = row.lifecycle === 'active' && row.installByDefault ? '' : ` [${row.lifecycle}]`;
    console.log(`  ${row.invocation.padEnd(20)} ${row.description}${status}`);
  }
  console.log('\nUse /<skill> [prompt] in a compatible agent surface.');
  console.log('Use /skills to discover skills, or /skill <exact-id> [prompt] when a host reports ambiguity.\n');
}

const argv = process.argv.slice(2);
if (argv[0] === 'skills' || (argv[0] === 'skill' && argv[1] === 'list')) {
  printSkills(argv);
} else {
  // Preserve the mature SC CLI unchanged; this wrapper only owns the portable skill registry.
  require('./sc.js');
}
