const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SC = path.join(ROOT, 'bin/sc.js');
const AGENT = path.join(ROOT, 'scripts/sc-agent.js');
const CP = require(path.join(ROOT, 'lib/custom-providers'));
const { checkUpdate, performUpdate } = require(path.join(ROOT, 'lib/update'));

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'sc-control-')); }
function run(args, { env = process.env, input = '' } = {}) {
  return execFileSync(process.execPath, [SC, ...args], { cwd: ROOT, env, input, encoding: 'utf8', timeout: 20000 });
}
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `git ${args.join(' ')} failed`);
  return (r.stdout || '').trim();
}

test('SCCP-1: custom provider metadata CRUD is persisted without credential values', () => {
  const dir = tmp();
  const file = path.join(dir, 'providers.json');
  const opts = { builtInIds: ['github'], builtInKeys: ['GITHUB_TOKEN'] };
  CP.createProvider({ id: 'demo', title: 'Demo', vars: [{ key: 'DEMO_API_KEY', prefix: 'demo_', minLength: 8 }] }, opts, file);
  CP.updateProvider('demo', { blurb: 'updated' }, opts, file);
  CP.addProviderVar('demo', { key: 'DEMO_ACCOUNT_ID', secret: false, note: 'public account id' }, opts, file);
  let defs = CP.loadCustomProviderDefs(opts, file);
  assert.strictEqual(defs.length, 1);
  assert.strictEqual(defs[0].blurb, 'updated');
  assert.deepStrictEqual(defs[0].vars.map(v => v.key), ['DEMO_API_KEY', 'DEMO_ACCOUNT_ID']);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /secret[_-]?value|demo_super_secret/i);
  CP.removeProviderVar('demo', 'DEMO_ACCOUNT_ID', opts, file);
  const removed = CP.deleteProvider('demo', opts, file);
  assert.strictEqual(removed.id, 'demo');
  assert.deepStrictEqual(CP.loadCustomProviderDefs(opts, file), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-2: custom provider cannot collide with built-in ids or env keys', () => {
  const dir = tmp();
  const file = path.join(dir, 'providers.json');
  const opts = { builtInIds: ['github'], builtInKeys: ['GITHUB_TOKEN'] };
  assert.throws(() => CP.createProvider({ id: 'github', vars: [{ key: 'OTHER_KEY' }] }, opts, file), /collides/);
  assert.throws(() => CP.createProvider({ id: 'demo', vars: [{ key: 'GITHUB_TOKEN' }] }, opts, file), /collides/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-3: secret set via stdin stores in 0600 profile while stdout/json/audit never reveal plaintext', () => {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  run(['providers', 'create', 'demo', '--key', 'DEMO_API_KEY', '--url', 'https://example.com/api-keys', '--prefix', 'demo_', '--min-length', '10'], { env });
  run(['user', 'add', 'agent'], { env });
  const secret = 'demo_private_credential_12345';
  const setOut = run(['secret', 'set', 'demo', 'DEMO_API_KEY', '--stdin'], { env, input: secret });
  assert.doesNotMatch(setOut, new RegExp(secret));
  const profile = path.join(config, 'profiles', 'agent.env');
  assert.ok(fs.readFileSync(profile, 'utf8').includes(secret), 'credential should be stored in the private profile file');
  assert.strictEqual(fs.statSync(profile).mode & 0o777, 0o600);

  const getOut = run(['secret', 'get', 'demo', 'DEMO_API_KEY', '--json'], { env });
  assert.doesNotMatch(getOut, new RegExp(secret));
  const showOut = run(['providers', 'show', 'demo'], { env });
  assert.doesNotMatch(showOut, new RegExp(secret));
  assert.match(showOut, /\[hidden len=\d+\]/);
  const row = JSON.parse(getOut).credentials[0];
  assert.strictEqual(row.state, 'set');
  assert.strictEqual(row.readable, false);

  const listOut = run(['providers', '--json'], { env });
  assert.doesNotMatch(listOut, new RegExp(secret));
  const auditOut = run(['audit', '--json'], { env });
  assert.doesNotMatch(auditOut, new RegExp(secret));
  assert.strictEqual(fs.statSync(path.join(config, 'audit.jsonl')).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(path.join(config, 'providers.json')).mode & 0o777, 0o600);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-4: sc run injects a stored secret into child env without sc printing it', () => {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  run(['providers', 'create', 'demo', '--key', 'DEMO_API_KEY', '--url', 'https://example.com/api-keys', '--prefix', 'demo_'], { env });
  run(['user', 'add', 'agent'], { env });
  run(['secret', 'set', 'demo', 'DEMO_API_KEY', '--stdin'], { env, input: 'demo_for_child' });
  const out = run(['run', '--', process.execPath, '-e', 'process.stdout.write(process.env.DEMO_API_KEY ? "present" : "missing")'], { env });
  assert.match(out, /present/);
  assert.doesNotMatch(out, /demo_for_child/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-5: MSO agent adapter has no plaintext secret input and returns only secret status/handoff', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.mso/functions.json'), 'utf8'));
  const forbidden = /^(value|secret|secretValue|token|tokenValue|password|apiKey|apiKeyValue)$/i;
  for (const fn of manifest.functions) {
    const props = Object.keys(fn.inputSchema?.properties || {});
    assert.ok(!props.some(k => forbidden.test(k)), `${fn.name} exposes a plaintext-secret-shaped input field`);
  }
  assert.ok(manifest.functions.some(fn => fn.name === 'sc.secret.request'));
  assert.ok(!manifest.functions.some(fn => /secret\.(set|put|rotate)/.test(fn.name)), 'agent surface must not accept secret creation values');

  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  run(['providers', 'create', 'demo', '--key', 'DEMO_API_KEY', '--url', 'https://example.com/api-keys'], { env });
  const r = spawnSync(process.execPath, [AGENT, 'secret.request'], {
    cwd: ROOT, env, input: JSON.stringify({ provider: 'demo', key: 'DEMO_API_KEY' }), encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /requiresUserTerminal/);
  assert.match(r.stdout, /sc secret set demo DEMO_API_KEY/);
  assert.match(r.stdout, /https:\/\/example\.com\/api-keys/);
  assert.match(r.stdout, /saveDestination/);
  assert.match(r.stdout, /\[rekomendasi\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-6: self-update fast-forwards only and refuses a dirty checkout', () => {
  const dir = tmp();
  const remote = path.join(dir, 'remote.git');
  const seed = path.join(dir, 'seed');
  const local = path.join(dir, 'local');
  fs.mkdirSync(seed, { recursive: true });
  git(dir, ['init', '--bare', remote]);
  git(seed, ['init']);
  git(seed, ['config', 'user.email', 'test@example.com']);
  git(seed, ['config', 'user.name', 'SC Test']);
  fs.writeFileSync(path.join(seed, 'file.txt'), 'one\n');
  git(seed, ['add', 'file.txt']); git(seed, ['commit', '-m', 'one']); git(seed, ['branch', '-M', 'main']);
  git(seed, ['remote', 'add', 'origin', remote]); git(seed, ['push', '-u', 'origin', 'main']);
  git(dir, ['clone', '-b', 'main', remote, local]);

  fs.writeFileSync(path.join(seed, 'file.txt'), 'two\n');
  git(seed, ['add', 'file.txt']); git(seed, ['commit', '-m', 'two']); git(seed, ['push']);
  const before = checkUpdate({ repoDir: local });
  assert.strictEqual(before.state, 'behind');
  assert.strictEqual(before.behind, 1);
  const result = performUpdate({ repoDir: local });
  assert.strictEqual(result.changed, true);
  assert.strictEqual(fs.readFileSync(path.join(local, 'file.txt'), 'utf8'), 'two\n');

  fs.writeFileSync(path.join(local, 'dirty.txt'), 'dirty\n');
  assert.throws(() => performUpdate({ repoDir: local }), /dirty checkout/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-7: plaintext export is disabled; sc run is the supported consumption path', () => {
  const r = spawnSync(process.execPath, [SC, 'env'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(`${r.stdout || ''}${r.stderr || ''}`, /plaintext credential export is disabled/);
});

test('SCCP-8: CLI help exposes update/provider/secret control-plane commands', () => {
  const out = run(['help']);
  assert.match(out, /sc update \[--check\]/);
  assert.match(out, /sc providers create/);
  assert.match(out, /sc secret set/);
  assert.match(out, /plaintext read is disabled/);
  assert.match(out, /sc env\s+disabled/);
});


test('SCCP-9: secret request promotes a simple userAction before technical credential details', () => {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  const r = spawnSync(process.execPath, [AGENT, 'secret.request'], {
    cwd: ROOT, env, input: JSON.stringify({ provider: 'resend', key: 'RESEND_API_KEY' }), encoding: 'utf8',
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.presentation.defaultField, 'userAction');
  assert.match(out.userAction.title, /akses|email/i);
  assert.ok(out.userAction.primaryAction.url.startsWith('https://'));
  assert.strictEqual(out.recommendation.label, '[rekomendasi]');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-10: user-scoped agent tools duplicate/read/delete credentials without plaintext', () => {
  const dir = tmp();
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, SC_CONFIG_DIR: config };
  run(['providers', 'create', 'demo', '--key', 'DEMO_API_KEY', '--url', 'https://example.com/api-keys', '--prefix', 'demo_'], { env });
  run(['user', 'add', 'alpha'], { env });
  const secret = 'demo_machine_private_123456';
  run(['secret', 'set', 'demo', 'DEMO_API_KEY', '--stdin'], { env, input: secret });

  const call = (action, input) => spawnSync(process.execPath, [AGENT, action], {
    cwd: ROOT, env, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000,
  });

  let r = call('user.list', {});
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, new RegExp(secret));
  assert.ok(JSON.parse(r.stdout).users.some(u => u.name === 'alpha'));

  r = call('user.duplicate', { source: 'alpha', target: 'beta', confirm: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, new RegExp(secret));
  assert.strictEqual(JSON.parse(r.stdout).target.name, 'beta');

  r = call('user.credentials.status', { user: 'beta', provider: 'demo' });
  assert.strictEqual(r.status, 0, r.stderr);
  const beta = JSON.parse(r.stdout);
  assert.strictEqual(beta.credentials[0].state, 'stored');
  assert.strictEqual(beta.credentials[0].readable, false);
  assert.doesNotMatch(r.stdout, new RegExp(secret));

  r = call('user.credential.request', { user: 'beta', provider: 'demo', key: 'DEMO_API_KEY' });
  assert.strictEqual(r.status, 0, r.stderr);
  const handoff = JSON.parse(r.stdout);
  assert.strictEqual(handoff.requiresUserTerminal, true);
  assert.match(handoff.command, /sc user credential-set beta demo DEMO_API_KEY/);
  assert.doesNotMatch(r.stdout, new RegExp(secret));

  r = call('user.credential.delete', { user: 'beta', provider: 'demo', key: 'DEMO_API_KEY', confirm: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).status.credentials[0].state, 'unset');
  assert.doesNotMatch(r.stdout, new RegExp(secret));

  r = call('user.credentials.status', { user: 'alpha', provider: 'demo' });
  assert.strictEqual(JSON.parse(r.stdout).credentials[0].state, 'stored', 'deleting beta must not alter alpha');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCCP-11: MCP lists user-scoped tools and rejects secret-shaped nested agent input', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.mso/functions.json'), 'utf8'));
  const names = new Set(manifest.functions.map(f => f.name));
  for (const name of [
    'sc.user.list', 'sc.user.show', 'sc.user.which', 'sc.user.create', 'sc.user.duplicate',
    'sc.user.rename', 'sc.user.default', 'sc.user.map', 'sc.user.delete',
    'sc.user.providers.list', 'sc.user.provider.verify', 'sc.user.credentials.status',
    'sc.user.credential.status', 'sc.user.credential.request', 'sc.user.credential.delete',
  ]) assert.ok(names.has(name), `${name} missing from tool manifest`);
  assert.ok(![...names].some(n => /^sc\.user\.credential\.(set|put|rotate)$/.test(n)), 'MCP must never accept credential values');

  const mcp = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT,
    input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`,
    encoding: 'utf8', timeout: 20000,
  });
  assert.strictEqual(mcp.status, 0, mcp.stderr);
  const listed = JSON.parse(mcp.stdout.trim()).result.tools.map(t => t.name);
  assert.ok(listed.includes('sc.user.credential.request'));
  assert.ok(listed.includes('sc.user.duplicate'));

  const bad = spawnSync(process.execPath, [AGENT, 'user.list'], {
    cwd: ROOT,
    input: JSON.stringify({ nested: { token: 'must-not-enter-agent-json' } }),
    encoding: 'utf8', timeout: 20000,
  });
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stderr, /forbidden on the agent surface/);
  assert.doesNotMatch(bad.stdout, /must-not-enter-agent-json/);
});
