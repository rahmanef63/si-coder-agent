'use strict';

const fs = require('fs');
const path = require('path');
const { assertNoSecrets } = require('./security');
const { ensureFoundation } = require('./memory-store');
const { slugify, normalizeId } = require('./markdown-record');

function rootPath(root = process.cwd()) { return path.resolve(root); }

function evidenceFile(root, id) {
  return path.join(rootPath(root), '.agent', 'evidence', `${normalizeId(id)}.json`);
}

function canonicalReceipt(input = {}, options = {}) {
  if (!input.target) throw new Error('evidence target is required');
  const generatedAt = options.generatedAt || input.generatedAt || new Date().toISOString();
  const id = normalizeId(input.id || `evidence-${slugify(input.target)}`);
  const receipt = {
    version: 1,
    id,
    target: String(input.target),
    generated_at: new Date(generatedAt).toISOString(),
    commit: input.commit ? String(input.commit) : null,
    risk: input.risk || null,
    command: input.command || null,
    arguments: Array.isArray(input.arguments) ? input.arguments.map(String) : [],
    exit_code: Number.isInteger(input.exitCode) ? input.exitCode : null,
    assertions: input.assertions && typeof input.assertions === 'object' ? input.assertions : {},
    checks: input.checks && typeof input.checks === 'object' ? input.checks : {},
    stdout_contract: input.stdoutContract || null,
    stderr_contract: input.stderrContract || null,
    filesystem_assertions: input.filesystemAssertions || {},
    metadata_assertions: input.metadataAssertions || {},
    permissions: input.permissions || {},
    secret_redaction: input.secretRedaction === undefined ? true : Boolean(input.secretRedaction),
    provider: input.provider || null,
    source: input.source || null,
    migration: input.migration || null,
  };
  assertNoSecrets(receipt, 'evidence receipt');
  return receipt;
}

function writeEvidence(input = {}, options = {}) {
  ensureFoundation(options.root);
  const receipt = canonicalReceipt(input, options);
  const file = evidenceFile(options.root, receipt.id);
  fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
  return { id: receipt.id, path: file, relativePath: path.relative(rootPath(options.root), file), receipt };
}

function readEvidence(id, options = {}) {
  const file = evidenceFile(options.root, id);
  if (!fs.existsSync(file)) throw new Error(`evidence ${id} not found`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { canonicalReceipt, writeEvidence, readEvidence, evidenceFile };
