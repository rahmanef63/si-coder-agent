#!/usr/bin/env node
// sc-agent.js — machine-facing adapter for MSO/agent function calling.
//
// This surface intentionally has NO operation that accepts a plaintext credential value.
// Agents can CRUD provider metadata, inspect secret status, delete credentials, run doctors,
// and self-update. Creation/rotation of a secret is a user-terminal handoff (`sc secret set`)
// or a trusted local stdin/env/file flow, never chat/tool JSON.
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../lib/profiles');
const UC = require('../lib/user-control');

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
  // Defense in depth: secret-shaped field names are forbidden recursively, not only at
  // the top level. A future schema edit must not accidentally turn MCP JSON into a secret transport.
  const inspect = (value, prefix = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      const field = prefix ? `${prefix}.${k}` : k;
      if (/^(value|secret|secretValue|token|tokenValue|password|apiKey|apiKeyValue)$/i.test(k)) {
        throw new Error(`field ${field} is forbidden on the agent surface; secrets must not enter tool JSON`);
      }
      inspect(v, field);
    }
  };
  inspect(input);

  switch (ACTION) {
    case 'product.interview': {
      const { productInterview } = require('../lib/product-interview');
      process.stdout.write(`${JSON.stringify(productInterview(input), null, 2)}\n`);
      return;
    }
    case 'user.list': {
      process.stdout.write(`${JSON.stringify(UC.listUsers(input.cwd || process.cwd()), null, 2)}
`);
      return;
    }
    case 'user.show': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      process.stdout.write(`${JSON.stringify(UC.showUser(user, input.cwd || process.cwd()), null, 2)}
`);
      return;
    }
    case 'user.which': {
      process.stdout.write(`${JSON.stringify(UC.whichUser(input.cwd || process.cwd()), null, 2)}
`);
      return;
    }
    case 'user.create': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const argv = ['user', 'add', user];
      if (input.owner) argv.push('--owner', assertString(input.owner, 'owner'));
      const r = captureSc(argv);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); if (r.stdout) process.stderr.write(r.stdout); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ created: true, user: UC.showUser(user) }, null, 2)}
`);
      return;
    }
    case 'user.duplicate': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const source = assertString(input.source, 'source', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const target = assertString(input.target, 'target', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const argv = ['user', 'duplicate', source, target];
      if (input.replaceEmpty === true) argv.push('--replace-empty');
      const r = captureSc(argv);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); if (r.stdout) process.stderr.write(r.stdout); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ duplicated: true, source, target: UC.showUser(target) }, null, 2)}
`);
      return;
    }
    case 'user.rename': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const source = assertString(input.source, 'source', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const target = assertString(input.target, 'target', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const r = captureSc(['user', 'rename', source, target]);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); if (r.stdout) process.stderr.write(r.stdout); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ renamed: true, source, target: UC.showUser(target) }, null, 2)}
`);
      return;
    }
    case 'user.default': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const r = captureSc(['user', 'use', user]);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ defaultUser: user, state: UC.listUsers() }, null, 2)}
`);
      return;
    }
    case 'user.map': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const cwd = assertString(input.path, 'path');
      const r = captureSc(['user', 'map', cwd, user]);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ mapped: true, path: cwd, user, resolution: UC.whichUser(cwd) }, null, 2)}
`);
      return;
    }
    case 'user.unmap': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const cwd = assertString(input.path, 'path');
      const r = captureSc(['user', 'unmap', cwd]);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ unmapped: true, path: cwd, resolution: UC.whichUser(cwd) }, null, 2)}
`);
      return;
    }
    case 'user.delete': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const before = UC.showUser(user);
      const r = captureSc(['user', 'rm', user, '--yes']);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ deleted: true, user, credentialCount: before.credentialCount, wasDefault: before.isDefault, foldersRemoved: before.folders }, null, 2)}
`);
      return;
    }
    case 'user.import-current': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const argv = ['user', 'import', user, '--yes'];
      if (input.overwrite === true) argv.push('--overwrite');
      const r = captureSc(argv);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ imported: true, user: UC.showUser(user) }, null, 2)}
`);
      return;
    }
    case 'user.providers.list': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      process.stdout.write(`${JSON.stringify({ user, providers: UC.userProviders(user) }, null, 2)}
`);
      return;
    }
    case 'user.provider.verify': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = input.provider ? assertString(input.provider, 'provider') : null;
      const r = captureSc(['user', 'verify', user, ...(provider ? [provider] : [])]);
      process.stdout.write(`${JSON.stringify({ user, provider, ok: r.code === 0, output: (r.stdout || r.stderr).trim() }, null, 2)}
`);
      process.exitCode = r.code;
      return;
    }
    case 'user.credentials.status': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      if (input.provider) {
        process.stdout.write(`${JSON.stringify(UC.providerStatus(user, assertString(input.provider, 'provider')), null, 2)}
`);
      } else {
        process.stdout.write(`${JSON.stringify({ user, providers: UC.userProviders(user) }, null, 2)}
`);
      }
      return;
    }
    case 'user.credential.status': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      process.stdout.write(`${JSON.stringify(key ? UC.credentialStatus(user, provider, key) : UC.providerStatus(user, provider), null, 2)}
`);
      return;
    }
    case 'user.credential.request': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const status = key ? UC.credentialStatus(user, provider, key) : UC.providerStatus(user, provider);
      const setup = key ? status.setup : null;
      process.stdout.write(`${JSON.stringify({
        ...status,
        requiresUserTerminal: true,
        command: key ? `sc user credential-set ${user} ${provider} ${key}` : `sc user credential-set ${user} ${provider}`,
        userAction: setup?.userCard || null,
        createAt: setup?.createAt || null,
        policy: 'Never send the credential in chat or tool JSON. Enter it only in the hidden local terminal prompt or an explicitly connected secure credential action.',
      }, null, 2)}
`);
      return;
    }
    case 'user.credential.delete': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const r = captureSc(['user', 'credential-rm', user, provider, ...(key ? [key] : []), '--yes']);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ deleted: true, user, provider, key, status: UC.providerStatus(user, provider) }, null, 2)}
`);
      return;
    }
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
      const setup = key ? status.credentials?.[0]?.setup : null;
      process.stdout.write(`${JSON.stringify({
        ...status,
        ...(setup ? {
          userAction: setup.userCard,
          createAt: setup.createAt,
          saveWith: setup.saveWith,
          saveDestination: setup.saveDestination,
          continueWith: setup.continueWith,
        } : {}),
        presentation: { defaultField: 'userAction', technicalDetails: 'opt-in' },
        requiresUserTerminal: true,
        command: `sc secret set ${provider}${key ? ` ${key}` : ''}`,
        policy: 'Create the access only at the official page shown above, then paste it only into the hidden terminal prompt; never send it in chat or tool JSON.',
        recommendation: {
          label: '[rekomendasi]',
          title: 'Verify access and continue',
          reason: 'This confirms the connection is ready before SI-Coder continues the web app.',
          beforeWeStart: ['the access has been stored'],
          offer: 'I will verify the connection and continue the previous step.',
          technicalCommand: setup?.continueWith || `sc doctor --providers ${provider}`,
        },
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
      if (input.runtime) argv.push('--runtime', assertString(input.runtime, 'runtime'));
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
