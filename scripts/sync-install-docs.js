#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
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
function markdownFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}
function assertLocalMarkdownLinks() {
  const mdLink = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const file of markdownFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(mdLink)) {
      const href = match[1].trim();
      if (!href || /^(?:https?:|mailto:|#)/i.test(href)) continue;
      const rawTarget = href.split('#')[0].replace(/^<|>$/g, '');
      if (!rawTarget) continue;
      const target = path.resolve(path.dirname(file), rawTarget);
      if (!target.startsWith(`${ROOT}${path.sep}`) && target !== ROOT) throw new Error(`markdown link escapes repository: ${path.relative(ROOT, file)} -> ${href}`);
      if (!fs.existsSync(target)) throw new Error(`broken markdown link: ${path.relative(ROOT, file)} -> ${href}`);
    }
  }
}
function assertCurrentVersionLinks(rel, version) {
  const text = read(rel);
  const patterns = [
    /si-coder-agent\/(?:tree|releases\/download)\/v(\d+\.\d+\.\d+)/g,
    /raw\.githubusercontent\.com\/rahmanef63\/si-coder-agent\/v(\d+\.\d+\.\d+)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) if (m[1] !== version) throw new Error(`${rel}: stale SI-Coder version v${m[1]} (current v${version})`);
  }
}

const pkg = JSON.parse(read('package.json'));
const version = pkg.version;
const sourceText = read('docs/install/README.md');
const table = between(sourceText, BEGIN, END);
const rows = parseRows(table);
if (rows.length < 7) throw new Error(`install matrix has too few rows: ${rows.length}`);


const currentVersionDocs = [
  'README.md',
  'AI_INSTALL.md',
  'references/portable-skills.md',
  'docs/install/README.md',
  'docs/install/claude-code.md',
  'docs/install/claude-web.md',
  'docs/install/codex.md',
  'docs/install/chatgpt-skills.md',
  'docs/install/generic-local.md',
];
for (const rel of currentVersionDocs) assertCurrentVersionLinks(rel, version);
assertLocalMarkdownLinks();

for (const file of fs.readdirSync(path.join(ROOT, 'docs/releases')).filter(name => /^v\d+\.\d+\.\d+\.md$/.test(name))) {
  if (file === `v${version}.md`) continue;
  requireText(read(`docs/releases/${file}`), /Historical release record/i, `historical release ${file}`);
}

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

const currentMarkdown = markdownFiles()
  .filter(file => !file.includes(`${path.sep}docs${path.sep}releases${path.sep}`))
  .map(file => fs.readFileSync(file, 'utf8'))
  .join('\n');
forbidText(currentMarkdown, /ChatGPT personal Skills/i, 'current Markdown terminology');
forbidText(currentMarkdown, /chatgpt-personal-skills\.md/i, 'current Markdown filename');

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

const chatgpt = read('docs/install/chatgpt-skills.md');
requireText(chatgpt, new RegExp(`releases/download/v${version.replaceAll('.', '\\.')}/sc\\.zip`), 'ChatGPT uploaded Skill');
requireText(chatgpt, /does \*\*not\*\* specify that a `\.skill` filename is required/i, 'ChatGPT uploaded Skill');
requireText(chatgpt, /optional.*`sc\.skill`/i, 'ChatGPT uploaded Skill');
requireText(chatgpt, /Business[\s\S]*Enterprise[\s\S]*Healthcare[\s\S]*Edu/i, 'ChatGPT Skill availability');
forbidText(sourceText, /ChatGPT personal Skills/i, 'install SSOT current terminology');

const workspace = read('docs/install/chatgpt-workspace-marketplace.md');
requireText(workspace, /github\.com\/rahmanef63\/si-coder-agent/, 'ChatGPT workspace');
requireText(workspace, /does \*\*not\*\* use `sc\.zip`, `sc\.skill`, or a raw `SKILL\.md` download/i, 'ChatGPT workspace');

const generic = read('docs/install/generic-local.md');
requireText(generic, new RegExp(`tree/v${version.replaceAll('.', '\\.')}/skills/sc`), 'Generic Agent Skills');
requireText(generic, /directory containing `SKILL\.md`|skill directory/i, 'Generic Agent Skills');

requireText(sourceText, /Node\.js 22\+/, 'install SSOT local runtime');
requireText(generic, /skills\/catalog\.json/, 'Generic Agent Skills lifecycle catalog');
requireText(generic, /2026-07-28/, 'Generic Agent Skills modern MCP');
const firstRun = read('docs/install/first-run-onboarding.md');
requireText(firstRun, /named-connection-first|named connection/i, 'first-run named connection');
requireText(firstRun, /does \*\*not\*\* write new provider secrets to `~\/\.bashrc`/i, 'first-run shell-global refusal');
requireText(firstRun, /Node\.js 22 or newer/i, 'first-run Node floor');
const toolCalling = read('docs/tool-calling.md');
requireText(toolCalling, /2026-07-28/, 'MCP modern protocol');
requireText(toolCalling, /2025-11-25/, 'MCP legacy compatibility');

const zip = fs.readFileSync(path.join(ROOT, 'dist/sc.zip'));
const skill = fs.readFileSync(path.join(ROOT, 'dist/sc.skill'));
if (!zip.equals(skill)) throw new Error('dist/sc.zip and dist/sc.skill must remain byte-identical sibling artifacts');
requireText(sourceText, /`sc\.zip` does not contain `sc\.skill`/i, 'install SSOT archive relationship');

if (checkOnly && drift) process.exit(1);
console.log(checkOnly ? `install-docs=PASS version=${version}` : `install-docs=SYNCED version=${version}`);
