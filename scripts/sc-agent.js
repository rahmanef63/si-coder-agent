#!/usr/bin/env node
// sc-agent.js — machine-facing adapter for bounded SI-Coder function calling.
//
// This surface intentionally has NO operation that accepts a plaintext credential value.
// Agents can CRUD provider metadata, inspect secret status, delete credentials, run doctors,
// and self-update. Creation/rotation of a secret is a user-terminal handoff (`sc secret set`)
// or a trusted local stdin/env/file flow, never chat/tool JSON.
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../lib/connections');
const { PROVIDERS } = require('../lib/providers');
const UC = require('../lib/user-control');
const CC = require('../lib/composio-connections');
const { credentialGuide } = require('../lib/credential-guidance');
const AgentActions = require('../lib/agent/actions');

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
    case 'task.risk': {
      process.stdout.write(`${JSON.stringify(AgentActions.taskRiskAction(input), null, 2)}\n`);
      return;
    }
    case 'task.prepare': {
      process.stdout.write(`${JSON.stringify(AgentActions.taskPrepareAction(input), null, 2)}\n`);
      return;
    }
    case 'memory.query': {
      process.stdout.write(`${JSON.stringify(AgentActions.memoryQueryAction(input), null, 2)}\n`);
      return;
    }
    case 'memory.record': {
      process.stdout.write(`${JSON.stringify(AgentActions.memoryRecordAction(input), null, 2)}\n`);
      return;
    }
    case 'memory.status': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      process.stdout.write(`${JSON.stringify(AgentActions.memoryStatusAction(input), null, 2)}\n`);
      return;
    }
    case 'evidence.record': {
      process.stdout.write(`${JSON.stringify(AgentActions.evidenceRecordAction(input), null, 2)}\n`);
      return;
    }
    case 'skill.verify': {
      const out = AgentActions.skillVerifyAction(input);
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      process.exitCode = out.ok ? 0 : 1;
      return;
    }
    case 'recipe.list': {
      process.stdout.write(`${JSON.stringify(AgentActions.recipeListAction(input), null, 2)}\n`);
      return;
    }
    case 'recipe.observe': {
      process.stdout.write(`${JSON.stringify(AgentActions.recipeObserveAction(input), null, 2)}\n`);
      return;
    }
    case 'recipe.verify': {
      process.stdout.write(`${JSON.stringify(AgentActions.recipeVerifyAction(input), null, 2)}\n`);
      return;
    }
    case 'recipe.promote': {
      process.stdout.write(`${JSON.stringify(AgentActions.recipePromoteAction(input), null, 2)}\n`);
      return;
    }
    case 'verify': {
      const out = AgentActions.repositoryVerifyAction(input);
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      process.exitCode = out.ok ? 0 : 1;
      return;
    }
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
    case 'user.connections.list': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = input.provider ? assertString(input.provider, 'provider') : null;
      process.stdout.write(`${JSON.stringify({ user, connections: UC.connectionsStatus(user, provider) }, null, 2)}\n`);
      return;
    }
    case 'user.connection.manage': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider', /^[a-z0-9][a-z0-9._-]{0,63}$/);
      const action = assertString(input.action, 'action');
      let argv;
      if (action === 'authorize') {
        const connection = assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/);
        const out = await CC.authorize(user, provider, connection, {
          authConfigId: input.authConfigId ? assertString(input.authConfigId, 'authConfigId', /^[A-Za-z0-9_-]{2,128}$/) : null,
          brokerConnection: input.brokerConnection ? assertString(input.brokerConnection, 'brokerConnection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null,
          callbackUrl: input.callbackUrl ? assertString(input.callbackUrl, 'callbackUrl') : null,
        });
        process.stdout.write(`${JSON.stringify({ action, ...out, policy: 'The authorization URL is transient; provider credentials and Composio link_token are not persisted by SI-Coder.' }, null, 2)}\n`);
        return;
      } else if (action === 'sync-external') {
        const connection = assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/);
        const out = await CC.sync(user, provider, connection);
        process.stdout.write(`${JSON.stringify({ action, ...out }, null, 2)}\n`);
        return;
      } else if (action === 'create') {
        const label = assertString(input.label, 'label');
        const source = input.source ? assertString(input.source, 'source', /^(sc|composio|native-mcp)$/) : 'sc';
        const authMethod = assertString(input.authMethod, 'authMethod', /^[a-z0-9][a-z0-9._-]{0,63}$/);
        argv = ['user','connection-add',user,provider,label,'--source',source,'--auth',authMethod];
        if (input.setDefault === true) argv.push('--default');
      } else if (action === 'set-default') {
        argv = ['user','connection-use',user,provider,assertString(input.connection,'connection',/^[a-z0-9][a-z0-9._-]{0,63}$/)];
      } else if (action === 'rename') {
        argv = ['user','connection-label',user,provider,assertString(input.connection,'connection',/^[a-z0-9][a-z0-9._-]{0,63}$/),assertString(input.label,'label')];
      } else if (action === 'delete') {
        argv = ['user','connection-rm',user,provider,assertString(input.connection,'connection',/^[a-z0-9][a-z0-9._-]{0,63}$/),'--yes'];
      } else if (action === 'migrate-legacy') {
        argv = ['user','connection-migrate',user,provider,'--yes'];
      } else throw new Error(`unsupported action ${action}`);
      const r = captureSc(argv);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); if (r.stdout) process.stderr.write(r.stdout); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ action, user, provider, connections: UC.connectionsStatus(user, provider) }, null, 2)}\n`);
      return;
    }
    case 'user.connection.request': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const providerId = assertString(input.provider, 'provider', /^[a-z0-9][a-z0-9._-]{0,63}$/);
      const provider = PROVIDERS.find(p => p.id === providerId);
      if (!provider) throw new Error(`unknown provider ${providerId}`);
      const sources = C.sourceOptions(provider).map(source => ({
        id: source.id, label: source.label, description: source.description || null,
        toolkit: source.toolkit || null, reference: source.reference || null,
        managedAuth: Boolean(source.managedAuth),
        authMethods: C.authOptions(provider, source.id).map(method => ({
          id: method.id, label: method.label, scheme: method.scheme, scope: method.scope,
          external: source.id !== 'sc', recommended: method.recommended || null,
          fields: method.fields || [], requiredFields: method.requiredFields || [],
          fieldGuidance: source.id === 'sc' ? (method.fields || []).map(key => {
            const g = credentialGuide(key, { user, override: method.guidance?.[key] || null });
            return { key, required: (method.requiredFields || []).includes(key), referenceUrl: g.referenceUrl, createCommand: g.createCommand, navigation: g.navigation, navigationText: g.navigationText, note: g.note };
          }) : [],
        })),
      }));
      if (!input.connection) {
        const selectedSource = input.source ? sources.find(x => x.id === input.source) : null;
        if (input.source && !selectedSource) throw new Error(`unsupported source ${input.source} for ${providerId}`);
        const selectedAuthMethod = input.authMethod
          ? (selectedSource || sources.find(src => src.authMethods.some(m => m.id === input.authMethod)))?.authMethods.find(m => m.id === input.authMethod) || null
          : null;
        process.stdout.write(`${JSON.stringify({
          user, provider: providerId, sources, selectedSource: selectedSource || null, selectedAuthMethod,
          next: selectedSource?.id === 'composio' ? 'create a labeled connection, then authorize it with a Composio Connect Link; no provider token belongs in SI-Coder' : selectedSource?.id === 'native-mcp' ? 'create a labeled connection and complete the provider-owned MCP/OAuth flow' : 'create a named connection, then enter each required credential through hidden local input',
          policy: 'Provider secrets must never be sent in chat or tool JSON.',
        }, null, 2)}
`);
        return;
      }
      const connection = UC.connectionStatus(user, providerId, assertString(input.connection,'connection',/^[a-z0-9][a-z0-9._-]{0,63}$/));
      const fieldSetup = connection.credentials.map(c => UC.credentialStatus(user, providerId, c.key, connection.id).setup).map(s => ({
        key:s.key, referenceUrl:s.referenceUrl, createCommand:s.createCommand, navigation:s.navigation, navigationText:s.navigationText, note:s.note,
        command:s.saveWith,
      }));
      const source = sources.find(x => x.id === connection.source) || null;
      process.stdout.write(`${JSON.stringify({
        user, provider: providerId, connection, source,
        externalConnectionAction: connection.source === 'composio' ? {
          strategy: 'composio-connect-link', toolkit: connection.externalRef?.toolkit || source?.toolkit || providerId,
          alias: connection.externalRef?.alias || connection.id, connectedAccountId: connection.externalRef?.connectedAccountId || null,
          authConfigId: connection.externalRef?.authConfigId || null, status: connection.state,
          requireExplicitSelectionWhenMultiple: true,
          secretHandling: 'OAuth/access/refresh tokens stay in Composio; SI-Coder persists only external identifiers and last-known status.',
        } : connection.source === 'native-mcp' ? {
          strategy: 'native-mcp-authorization', toolkit: connection.externalRef?.toolkit || source?.toolkit || providerId, status: connection.state,
          secretHandling: 'Provider-owned MCP/OAuth credentials are not copied into SI-Coder.',
        } : null,
        next: connection.source === 'composio' ? (connection.state === 'active' ? 'use the explicit connected account id/alias when executing Composio tools' : 'authorize or refresh this connection through the Composio Connect Link flow') : connection.source === 'native-mcp' ? 'complete or use the provider-owned MCP authorization' : 'enter only missing fields in the hidden local terminal',
        fields: fieldSetup,
        policy: 'Never send provider credentials in chat or tool JSON.',
      }, null, 2)}
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
      const connection = input.connection ? assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null;
      const argv = ['user', 'verify', user, ...(provider ? [provider] : [])];
      if (connection) argv.push('--connection', connection);
      const r = captureSc(argv);
      process.stdout.write(`${JSON.stringify({ user, provider, connection, ok: r.code === 0, output: (r.stdout || r.stderr).trim() }, null, 2)}
`);
      process.exitCode = r.code;
      return;
    }
    case 'user.credentials.status': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      if (input.provider) {
        const provider = assertString(input.provider, 'provider');
        const connection = input.connection ? assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null;
        process.stdout.write(`${JSON.stringify(UC.providerStatus(user, provider, connection), null, 2)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ user, providers: UC.userProviders(user) }, null, 2)}\n`);
      }
      return;
    }
    case 'user.credential.status': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const connection = input.connection ? assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null;
      process.stdout.write(`${JSON.stringify(key ? UC.credentialStatus(user, provider, key, connection) : UC.providerStatus(user, provider, connection), null, 2)}\n`);
      return;
    }
    case 'user.credential.request': {
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const connection = input.connection ? assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null;
      const providerStatus = UC.providerStatus(user, provider, connection);
      const external = Boolean(providerStatus.external);
      const status = external ? providerStatus : key ? UC.credentialStatus(user, provider, key, connection) : providerStatus;
      const setup = !external && key ? status.setup : null;
      process.stdout.write(`${JSON.stringify({
        ...status,
        requiresUserTerminal: external ? false : true,
        command: external ? null : key ? `sc user credential-set ${user} ${provider} ${key}${connection ? ` --connection ${connection}` : ''}` : `sc user credential-set ${user} ${provider}${connection ? ` --connection ${connection}` : ''}`,
        userAction: external ? null : setup?.userCard || null,
        createAt: external ? null : setup?.createAt || null,
        referenceUrl: external ? null : setup?.referenceUrl || null,
        createCommand: external ? null : setup?.createCommand || null,
        navigation: external ? [] : setup?.navigation || [],
        navigationText: external ? null : setup?.navigationText || null,
        next: external ? `This connection uses source=${status.source}; use sc.user.connection.request and the external authorization/execution flow instead of requesting a local provider credential.` : null,
        policy: external ? 'Externally managed provider credentials must stay in their source backend and are never requested through SI-Coder credential tools.' : 'Never send the credential in chat or tool JSON. Enter it only in the hidden local terminal prompt or an explicitly connected secure credential action.',
      }, null, 2)}
`);
      return;
    }
    case 'user.credential.delete': {
      if (input.confirm !== true) throw new Error('confirm=true is required');
      const user = assertString(input.user, 'user', /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      const provider = assertString(input.provider, 'provider');
      const key = input.key ? assertString(input.key, 'key', /^[A-Z][A-Z0-9_]{1,127}$/) : null;
      const connection = input.connection ? assertString(input.connection, 'connection', /^[a-z0-9][a-z0-9._-]{0,63}$/) : null;
      const argv = ['user', 'credential-rm', user, provider, ...(key ? [key] : []), '--yes'];
      if (connection) argv.push('--connection', connection);
      const r = captureSc(argv);
      if (r.code !== 0) { if (r.stderr) process.stderr.write(r.stderr); process.exitCode = r.code; return; }
      process.stdout.write(`${JSON.stringify({ deleted: true, user, provider, connection, key, status: UC.providerStatus(user, provider, connection) }, null, 2)}
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
      pushOpt(argv, '--url', input.url); pushOpt(argv, '--note', input.note); pushOpt(argv, '--navigation', input.navigation);
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
      pushOpt(argv, '--url', input.url); pushOpt(argv, '--note', input.note); pushOpt(argv, '--navigation', input.navigation);
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
          referenceUrl: setup.referenceUrl,
          createCommand: setup.createCommand,
          navigation: setup.navigation,
          navigationText: setup.navigationText,
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
