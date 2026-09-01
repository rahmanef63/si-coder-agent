#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'docs/install/README.md');
const BEGIN = '<!-- INSTALL_MATRIX_SSOT:BEGIN -->';
const END = '<!-- INSTALL_MATRIX_SSOT:END -->';
const GEN_BEGIN = '<!-- INSTALL_MATRIX_GENERATED:BEGIN -->';
const GEN_END = '<!-- INSTALL_MATRIX_GENERATED:END -->';
const checkOnly = process.argv.includes('--check');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, text) { fs.writeFileSync(path.join(ROOT, rel), text); }
function between(text, begin, end) {
  const a = text.indexOf(begin);
  const b = text.indexOf(end);
  if (a < 0 || b < 0 || b <= a) throw new Error(`missing or invalid markers: ${begin} ... ${end}`);
  return text.slice(a + begin.length, b).trim();
}
function replaceGenerated(text, body) {
  const block = `${GEN_BEGIN}\n${body.trim()}\n${GEN_END}`;
  const a = text.indexOf(GEN_BEGIN);
  const b = text.indexOf(GEN_END);
  if (a >= 0 && b > a) return text.slice(0, a) + block + text.slice(b + GEN_END.length);
  throw new Error('generated install matrix markers are missing');
}
function parseRows(table) {
  return table.split('\n')
    .filter(line => line.startsWith('|') && !/^\|\s*---/.test(line))
    .slice(1)
    .map(line => line.split('|').slice(1, -1).map(x => x.trim()));
}
function requireText(text, pattern, label) {
  if (!pattern.test(text)) throw new Error(`${label}: expected ${pattern}`);
}
function forbidText(text, pattern, label) {
  if (pattern.test(text)) throw new Error(`${label}: forbidden ${pattern}`);
}

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const sourceText = read('docs/install/README.md');
const table = between(sourceText, BEGIN, END);
const rows = parseRows(table);
if (rows.length < 7) throw new Error(`install matrix has too few rows: ${rows.length}`);

const generatedBody = `### Installation format matrix\n\n> Generated from [docs/install/README.md](docs/install/README.md). Do not edit this matrix here.\n\n${table}`;
const releaseBody = `## Install transport by surface\n\n> Generated from [docs/install/README.md](../install/README.md). Do not edit this matrix here.\n\n${table}`;

const targets = [
  ['README.md', generatedBody],
  [`docs/releases/v${version}.md`, releaseBody],
];

let drift = false;
for (const [rel, body] of targets) {
  const oldText = read(rel);
  const next = replaceGenerated(oldText, body);
  if (oldText !== next) {
    drift = true;
    if (!checkOnly) write(rel, next);
    else console.error(`install-doc drift: ${rel}`);
  }
}

// Surface-contract assertions are intentionally kept here so CI guards the SSOT and the per-surface guides together.
const claudeWeb = read('docs/install/claude-web.md');
requireText(claudeWeb, new RegExp(`releases/download/v${version.replaceAll('.', '\\.')}/sc\\.zip`), 'Claude Web');
requireText(claudeWeb, /ZIP/i, 'Claude Web');
requireText(claudeWeb, /SKILL\.md/, 'Claude Web');
forbidText(claudeWeb, /Download[^\n]*sc\.skill/i, 'Claude Web default');

const codex = read('docs/install/codex.md');
requireText(codex, new RegExp(`tree/v${version.replaceAll('.', '\\.')}/skills/sc`), 'Codex');
requireText(codex, /SKILL\.md/, 'Codex');
forbidText(codex, new RegExp(`releases/download/v${version.replaceAll('.', '\\.')}/sc\\.(zip|skill)`), 'Codex transport');

const chatgpt = read('docs/install/chatgpt-personal-skills.md');
requireText(chatgpt, new RegExp(`releases/download/v${version.replaceAll('.', '\\.')}/sc\\.zip`), 'ChatGPT personal');
requireText(chatgpt, /does \*\*not\*\* specify that a `\.skill` filename is required/i, 'ChatGPT personal');
requireText(chatgpt, /optional.*`sc\.skill`/i, 'ChatGPT personal');

const workspace = read('docs/install/chatgpt-workspace-marketplace.md');
requireText(workspace, /github\.com\/rahmanef63\/si-coder-agent/, 'ChatGPT workspace');
requireText(workspace, /does \*\*not\*\* use `sc\.zip`, `sc\.skill`, or a raw `SKILL\.md` download/i, 'ChatGPT workspace');

const generic = read('docs/install/generic-local.md');
requireText(generic, new RegExp(`tree/v${version.replaceAll('.', '\\.')}/skills/sc`), 'Generic Agent Skills');
requireText(generic, /directory containing `SKILL\.md`|skill directory/i, 'Generic Agent Skills');

const zip = fs.readFileSync(path.join(ROOT, 'dist/sc.zip'));
const skill = fs.readFileSync(path.join(ROOT, 'dist/sc.skill'));
if (!zip.equals(skill)) throw new Error('dist/sc.zip and dist/sc.skill must remain byte-identical sibling artifacts');
requireText(sourceText, /`sc\.zip` does not contain `sc\.skill`/i, 'install SSOT archive relationship');

if (checkOnly && drift) process.exit(1);
console.log(checkOnly ? `install-docs=PASS version=${version}` : `install-docs=SYNCED version=${version}`);
