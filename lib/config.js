// config.js — shared si-coder state paths.
// Keep this dependency-free so provider/profile modules can both use it without cycles.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG_DIR = process.env.SC_CONFIG_DIR || path.join(os.homedir(), '.config', 'si-coder');
const CUSTOM_PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');
const AUDIT_FILE = path.join(CONFIG_DIR, 'audit.jsonl');

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(CONFIG_DIR, 0o700); } catch { /* best effort */ }
  return CONFIG_DIR;
}

module.exports = { CONFIG_DIR, CUSTOM_PROVIDERS_FILE, AUDIT_FILE, ensureConfigDir };
