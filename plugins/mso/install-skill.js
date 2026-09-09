#!/usr/bin/env node
'use strict';

// Optional MSO adapter only; core SI-Coder never imports this module.

// MSO ignores directory symlinks. Materialize reviewed package sources with
// provenance, bounded bundle copying and local-edit protection.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { bundleEntries, copyBundle } = require('../../lib/skill-store');

const MARKER = '.si-coder-install.json';
function snapshot(dir) {
  return Object.fromEntries(bundleEntries(dir).rows
    .filter(row => row.relative !== MARKER)
    .map(row => [row.relative, row.type === 'dir' ? 'directory'
      : crypto.createHash('sha256').update(fs.readFileSync(row.absolute)).digest('hex')])
    .sort(([a], [b]) => a.localeCompare(b)));
}
function stat(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function ownedDestination(destination, source) {
  const info = stat(destination);
  if (!info) return 'missing';
  if (info.isSymbolicLink()) {
    if (fs.realpathSync(destination) !== source) throw new Error('refusing to replace an unrelated skill symlink: ' + destination);
    return 'legacy-link';
  }
  const marker = path.join(destination, MARKER);
  if (!info.isDirectory() || !stat(marker)?.isFile() || stat(marker).isSymbolicLink()) {
    throw new Error('refusing to replace an unmanaged skill: ' + destination);
  }
  const previous = JSON.parse(fs.readFileSync(marker, 'utf8'));
  if (previous.format !== 1 || previous.source !== source ||
      JSON.stringify(previous.files) !== JSON.stringify(snapshot(destination))) {
    throw new Error('refusing to overwrite a modified or unrelated skill: ' + destination);
  }
  return 'managed-copy';
}
function installMsoSkill(sourcePath, destinationRoot) {
  const source = path.resolve(sourcePath);
  // Validate before resolving: a package source itself cannot be a link.
  bundleEntries(source);
  const canonicalSource = fs.realpathSync(source);
  const root = path.resolve(destinationRoot);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('MSO skill install root must be a real directory');
  }
  const destination = path.join(root, path.basename(source));
  const prior = ownedDestination(destination, canonicalSource);
  const stage = fs.mkdtempSync(path.join(root, '.si-coder-stage-'));
  const backup = stage + '-previous';
  let backedUp = false;
  try {
    copyBundle(source, stage);
    const files = snapshot(stage);
    fs.writeFileSync(path.join(stage, MARKER), JSON.stringify({
      format: 1, source: canonicalSource, files
    }, null, 2) + '\n', { mode: 0o600 });
    if (ownedDestination(destination, canonicalSource) !== prior) throw new Error('skill destination changed during install');
    if (prior !== 'missing') {
      fs.renameSync(destination, backup);
      backedUp = true;
    }
    fs.renameSync(stage, destination);
    if (backedUp) fs.rmSync(backup, { recursive: true });
    return destination;
  } catch (error) {
    if (backedUp && !stat(destination)) fs.renameSync(backup, destination);
    throw error;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('usage: install-mso-skill <source-directory> <destination-root>');
    console.log('Installed MSO skill: ' + installMsoSkill(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { installMsoSkill };
