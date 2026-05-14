// lib/env.js — shared env-string parsing + ~/.bashrc / .env file helpers
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseEnvString(envString = '') {
  const env = {};
  for (const rawLine of envString.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key) env[key] = value;
  }
  return env;
}

function mergeEnvString(existingEnv = '', updates = {}) {
  const lines = existingEnv.split(/\r?\n/).filter(l => l.trim().length > 0);
  const env = parseEnvString(existingEnv);
  const order = [];
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key && !order.includes(key)) order.push(key);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    if (!order.includes(key)) order.push(key);
    env[key] = String(value);
  }
  return order.map(k => `${k}=${env[k]}`).join('\n');
}

function scanProcessEnv(keys = []) {
  const present = {};
  const missing = [];
  for (const k of keys) {
    if (process.env[k] && process.env[k].length > 0) present[k] = process.env[k];
    else missing.push(k);
  }
  return { present, missing };
}

function readShellRc(shellRcPath = path.join(os.homedir(), '.bashrc')) {
  if (!fs.existsSync(shellRcPath)) return '';
  return fs.readFileSync(shellRcPath, 'utf8');
}

function appendExportToShellRc(updates, shellRcPath = path.join(os.homedir(), '.bashrc')) {
  const stamp = new Date().toISOString();
  const block = ['', `# --- si-coder onboarding (${stamp}) ---`];
  for (const [k, v] of Object.entries(updates)) {
    block.push(`export ${k}=${JSON.stringify(v)}`);
  }
  block.push('# --- end si-coder onboarding ---', '');
  fs.appendFileSync(shellRcPath, block.join('\n'));
}

module.exports = {
  parseEnvString,
  mergeEnvString,
  scanProcessEnv,
  readShellRc,
  appendExportToShellRc,
};
