#!/usr/bin/env node
// sc-agent.js — machine-facing adapter for MSO/agent function calling.
//
// This surface intentionally has NO operation that accepts a plaintext credential value.
// Agents can CRUD provider metadata, inspect secret status, delete credentials, run doctors,
// and self-update. Creation/rotation of a secret is a user-terminal handoff (`sc secret set`)
// or a trusted local stdin/env/file flow, never chat/tool JSON.
const path = require('path');
const { spawnSync } = require('child_process');

const SC = path.resolve(__dirname, '../bin/sc.js');
const ACTION = process.argv[2];

function readJson() {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { data += c; if (data.length > 256 * 1024) process.exit(2); });
  return new Promise((resolve, reject) => {
    process.stdin.on('end', () => {
      if (!data.trim()) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`invalid JSON input: ${e.message}`)); }
    });
    process.stdin.on('error', reject);
  });
}

function assertString(v, name, re = null) {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${name} is required`);
  if (re && !re.test(v)) throw new Error(`invalid ${name}`);
  return v;
}

function pushOpt(argv, flag, value) {
  if (value === undefined || value === null || value === '') return;
  argv.push(flag, String(value));
}

function captureSc(argv) {
  const r = spawnSync(process.execPath, [SC, ...argv], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runSc(argv) {
  const r = captureSc(argv);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exitCode = r.code;
}

function providerArgs(input) {
  const id = assertString(input.id, 'id', /^[a-z0-9][a-z0-9._-]{0,63}$/);
  return { id };
}

async function main() {
  const input = await readJson();
  // Defense in depth: these names should never exist in the MCP schema. Reject them anyway
  // so a future manifest edit cannot silently turn tool JSON into a secret transport.
  for (const k of Object.keys(input)) {
    if (/^(value|secret|secretValue|token|tokenValue|password|apiKey|apiKeyValue)$/i.test(k)) {
      throw new Error(`field ${k} is forbidden on the agent surface; secrets must not enter tool JSON`);
    }
  }

  switch (ACTION) {
    case 'providers.list':
      return runSc(['providers', '--json']);
    case 'provider.create': {
      const { id } = providerArgs(input);
      const key = assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/);
      const argv = ['providers', 'create', id, '--key', key];
      pushOpt(argv, '--title', input.title); pushOpt(argv, '--blurb', input.blurb);
      pushOpt(argv, '--url', input.url); pushOpt(argv, '--note', input.note);
      pushOpt(argv, '--prefix', input.prefix); pushOpt(argv, '--min-length', input.minLength);
      if (input.required === true) argv.push('--required');
      if (input.public === true) argv.push('--public');
      return runSc(argv);
    }
    case 'provider.update': {
      const { id } = providerArgs(input);
      const argv = ['providers', 'update', id];
      pushOpt(argv, '--title', input.title); pushOpt(argv, '--blurb', input.blurb);
      return runSc(argv);
    }
    case 'provider.delete': {
      const { id } = providerArgs(input);
      if (input.confirmPurgeCredentials !== true) throw new Error('confirmPurgeCredentials=true is required');
      return runSc(['providers', 'delete', id, '--yes']);
    }
    case 'provider.key-add': {
      const { id } = providerArgs(input);
      const key = assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/);
      const argv = ['providers', 'key-add', id, key];
      pushOpt(argv, '--url', input.url); pushOpt(argv, '--note', input.note);
      pushOpt(argv, '--prefix', input.prefix); pushOpt(argv, '--min-length', input.minLength);
      if (input.required === true) argv.push('--required');
      if (input.public === true) argv.push('--public');
      return runSc(argv);
    }
    case 'provider.key-remove': {
      const { id } = providerArgs(input);
      const key = assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/);
      if (input.confirmPurgeCredentials !== true) throw new Error('confirmPurgeCredentials=true is required');
      return runSc(['providers', 'key-rm', id, key, '--yes']);
    }
    case 'secrets.status': {
      const argv = ['secret', 'list'];
      if (input.provider) argv.push(assertString(input.provider, 'provider'));
      argv.push('--json');
      return runSc(argv);
    }
    case 'secret.request': {
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const r = captureSc(['secret', 'get', provider, ...(key ? [key] : []), '--json']);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      const status = JSON.parse(r.stdout);
      process.stdout.write(`${JSON.stringify({
        ...status,
        requiresUserTerminal: true,
        command: `sc secret set ${provider}${key ? ` ${key}` : ''}`,
        policy: 'Paste the secret only into the hidden terminal prompt; never send it in chat or tool JSON.',
      }, null, 2)}\n`);
      return;
    }
    case 'secret.delete': {
      const provider = assertString(input.provider, 'provider');
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const argv = ['secret', 'rm', provider];
      if (input.key) argv.push(assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/));
      argv.push('--yes');
      return runSc(argv);
    }
    case 'deploy.plan': {
      const argv = ['deploy', 'plan', '--json'];
      if (input.target) argv.push('--target', assertString(input.target, 'target'));
      if (input.composioAvailable === true) argv.push('--composio');
      if (input.composioAvailable === false) argv.push('--no-composio');
      if (input.vpsAvailable === true) argv.push('--vps');
      if (input.vpsAvailable === false) argv.push('--no-vps');
      return runSc(argv);
    }
    case 'doctor': {
      const argv = ['doctor'];
      if (Array.isArray(input.providers) && input.providers.length) argv.push('--providers', input.providers.map(x => assertString(x, 'provider')).join(','));
      return runSc(argv);
    }
    case 'update.check':
      return runSc(['update', '--check', '--json']);
    case 'update.apply':
      if (input.confirm !== true) throw new Error('confirm=true is required');
      return runSc(['update', '--json']);
    case 'version':
      return runSc(['version', '--json']);
    default:
      throw new Error(`unknown sc-agent action ${JSON.stringify(ACTION)}`);
  }
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
