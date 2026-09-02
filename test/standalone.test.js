'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function textFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) textFiles(full, out);
    else if (entry.isFile() && /\.(?:md|js|json|yaml|yml|sh|py|example)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('STANDALONE-1: machine-function SSOT is SI-Coder-local and no host-specific manifest is shipped', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'machine', 'functions.json')));
  assert.ok(!fs.existsSync(path.join(ROOT, '.mso', 'functions.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.files.includes('machine/'));
  assert.ok(!pkg.files.includes('.mso/'));
  const mcp = fs.readFileSync(path.join(ROOT, 'scripts', 'sc-mcp.js'), 'utf8');
  assert.match(mcp, /machine\/functions\.json/);
});

test('STANDALONE-2: current user-facing docs and skills contain no environment-specific sibling-project defaults', () => {
  const files = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'SKILL.md'),
    path.join(ROOT, 'AI_INSTALL.md'),
    ...textFiles(path.join(ROOT, 'skills')),
    ...textFiles(path.join(ROOT, 'docs', 'install')),
    path.join(ROOT, 'docs', 'cli.md'),
    path.join(ROOT, 'docs', 'tool-calling.md'),
    path.join(ROOT, 'docs', 'agent-workflow.md'),
  ];
  const forbidden = [
    /\bMSO\b/,
    /rahmanef\.com/i,
    /antinrml\.com/i,
    /\bPlay Together\b/i,
    /\bBaton\b/,
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern, `${path.relative(ROOT, file)} leaked ${pattern}`);
  }
});

test('STANDALONE-3: core runtime contains no absolute owner-project import/dependency path', () => {
  const files = [
    ...textFiles(path.join(ROOT, 'lib')),
    ...textFiles(path.join(ROOT, 'bin')),
    ...textFiles(path.join(ROOT, 'scripts')),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\/home\/[^/]+\/projects\//, `${path.relative(ROOT, file)} contains an owner project path`);
    assert.doesNotMatch(text, /require\([^\n]*\.\.\/\.\.\/\.\.\//, `${path.relative(ROOT, file)} imports beyond the repository boundary`);
  }
});

test('STANDALONE-4: n8n and Resend skills require explicit project/account configuration', () => {
  const n8n = fs.readFileSync(path.join(ROOT, 'skills', 'sc-n8n', 'SKILL.md'), 'utf8');
  assert.match(n8n, /user-selected n8n instance/i);
  assert.match(n8n, /N8N_URL/);
  assert.doesNotMatch(n8n, /\.bashrc line|live prod|~\/backups\/n8n/i);

  const resend = fs.readFileSync(path.join(ROOT, 'skills', 'sc-resend', 'SKILL.md'), 'utf8');
  assert.match(resend, /Sender identity is project configuration/i);
  assert.match(resend, /transactional@example\.com/);
});
