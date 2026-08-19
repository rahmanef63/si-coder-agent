#!/usr/bin/env node
// output-style.js — print the active si-coder output style, or list the choices.
//
//   node scripts/output-style.js                 # print the prompt for $SC_OUTPUT_STYLE (empty if off)
//   node scripts/output-style.js --name           # print just the resolved style name
//   node scripts/output-style.js --list           # list all styles + blurbs
//   node scripts/output-style.js --style caveman   # print a specific style's prompt (ignores env)
//
// The agent running the sc-* skills reads $SC_OUTPUT_STYLE and adopts the printed instruction.
// See references/output-styles.md and the umbrella SKILL.md "Output styles" section.
const path = require('path');
const {
  STYLE_NAMES, STYLE_BLURBS, resolveStyle, stylePrompt,
} = require(path.resolve(__dirname, '../lib/output-styles'));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const n = argv[i + 1];
    if (n !== undefined && !n.startsWith('--')) { o[k] = n; i++; } else { o[k] = true; }
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  for (const name of STYLE_NAMES) {
    console.log(`${name.padEnd(9)} ${STYLE_BLURBS[name] || ''}`);
  }
  process.exit(0);
}

// An explicit --style wins over the environment; otherwise read SC_OUTPUT_STYLE.
const raw = (typeof args.style === 'string') ? args.style : process.env.SC_OUTPUT_STYLE;
const name = resolveStyle(raw);

if (args.name) { console.log(name); process.exit(0); }

// Print the prompt (empty line for 'off'). Callers append this to their instructions.
process.stdout.write(stylePrompt(raw));
if (stylePrompt(raw)) process.stdout.write('\n');
