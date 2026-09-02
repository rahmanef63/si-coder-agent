'use strict';

const fs = require('fs');
const path = require('path');
const { parseDocument } = require('./markdown-record');
const { scanSecretRisks } = require('./security');

const REQUIRED_META = ['name', 'description'];
const TRIGGER_KEYS = ['use_when', 'do_not_use_when'];
const QUALITY_KEYS = ['required_tools', 'security_constraints', 'references', 'compatibility'];

function rootPath(root = process.cwd()) { return path.resolve(root); }

function skillFiles(root = process.cwd()) {
  const base = rootPath(root);
  const out = [];
  const rootSkill = path.join(base, 'SKILL.md');
  if (fs.existsSync(rootSkill)) out.push(rootSkill);
  const skillsDir = path.join(base, 'skills');
  if (!fs.existsSync(skillsDir)) return out;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name === 'SKILL.md') out.push(full);
    }
  };
  walk(skillsDir);
  return [...new Set(out)].sort();
}

function triggerContractFromBody(body) {
  const section = /##\s+Trigger contract\s*\n([\s\S]*?)(?=\n##\s+|$)/i.exec(body || '');
  if (!section) return {};
  const result = {};
  for (const line of section[1].split('\n')) {
    const m = /^\s*[-*]?\s*(use_when|do_not_use_when|required_tools|security_constraints|references|compatibility)\s*:\s*(.+)$/i.exec(line);
    if (m) result[m[1].toLowerCase()] = m[2].trim();
  }
  return result;
}

function asList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map(x => x.trim()).filter(Boolean);
  return [];
}

function referenceProblems(file, refs) {
  const dir = path.dirname(file);
  const problems = [];
  for (const ref of refs) {
    if (/^https?:\/\//i.test(ref)) continue;
    const candidate = path.resolve(dir, ref);
    if (!fs.existsSync(candidate)) problems.push(ref);
  }
  return problems;
}

function duplicateInstructionLines(body) {
  const seen = new Map();
  const duplicates = [];
  let inFence = false;
  for (const line of String(body || '').split('\n')) {
    if (line.trim().startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    const normalized = line.trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized.length < 80) continue;
    const count = (seen.get(normalized) || 0) + 1;
    seen.set(normalized, count);
    if (count === 2) duplicates.push(line.trim().slice(0, 140));
  }
  return duplicates.slice(0, 8);
}

function verifySkill(file, options = {}) {
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseDocument(content);
  const meta = parsed.meta;
  const contract = triggerContractFromBody(parsed.body);
  const effective = { ...meta, ...Object.fromEntries(Object.entries(contract).filter(([, v]) => v !== undefined)) };
  const errors = [];
  const warnings = [];

  for (const key of REQUIRED_META) if (!effective[key]) errors.push(`missing metadata: ${key}`);
  for (const key of TRIGGER_KEYS) {
    if (!effective[key]) (options.strict ? errors : warnings).push(`missing explicit trigger contract: ${key}`);
  }
  for (const key of QUALITY_KEYS) {
    if (effective[key] === undefined) warnings.push(`missing quality metadata: ${key}`);
  }

  const refs = asList(effective.references);
  const missingRefs = referenceProblems(file, refs);
  if (missingRefs.length) errors.push(`missing references: ${missingRefs.join(', ')}`);

  const requiredTools = asList(effective.required_tools);
  if (Array.isArray(options.supportedTools) && options.supportedTools.length) {
    const unsupported = requiredTools.filter(tool => !options.supportedTools.includes(tool));
    if (unsupported.length) errors.push(`unsupported tools: ${unsupported.join(', ')}`);
  }

  const secretRisks = scanSecretRisks(content);
  if (secretRisks.length) errors.push(`secret-shaped content: ${secretRisks.map(r => r.reason).join(', ')}`);

  const duplicates = duplicateInstructionLines(parsed.body);
  if (duplicates.length) warnings.push(`duplicated long instructions: ${duplicates.length}`);

  return {
    file,
    relativePath: path.relative(rootPath(options.root), file),
    name: effective.name || null,
    description: effective.description || null,
    triggerContract: {
      useWhen: effective.use_when || null,
      doNotUseWhen: effective.do_not_use_when || null,
    },
    requiredTools,
    references: refs,
    compatibility: effective.compatibility || null,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function verifySkills(options = {}) {
  const files = skillFiles(options.root);
  const skills = files.map(file => verifySkill(file, options));
  const errorCount = skills.reduce((n, row) => n + row.errors.length, 0);
  const warningCount = skills.reduce((n, row) => n + row.warnings.length, 0);
  return {
    ok: errorCount === 0,
    strict: Boolean(options.strict),
    skillCount: skills.length,
    errorCount,
    warningCount,
    skills,
  };
}

module.exports = { skillFiles, verifySkill, verifySkills, triggerContractFromBody };
