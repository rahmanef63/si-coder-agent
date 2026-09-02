const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { planDeploy } = require('../lib/deploy-route');

function routing(plan) {
  return Object.fromEntries(plan.providerRouting.map(x => [x.provider, x.backend]));
}

test('SCPORT-1: hosted runtime skips VPS branch and uses full Composio', () => {
  const p = planDeploy({ runtime: 'hosted', env: {}, composioAvailable: true });
  assert.strictEqual(p.runtime, 'hosted');
  assert.strictEqual(p.route, 'hosted-managed');
  assert.strictEqual(p.target, 'vercel');
  assert.strictEqual(p.decisionRequired, null);
  assert.strictEqual(p.executionEngine, 'composio');
  assert.deepStrictEqual(p.connectorToolkits, ['github', 'convex', 'vercel', 'hostinger']);
  assert.deepStrictEqual(routing(p), {
    github: 'composio', vercel: 'composio', convex: 'composio', hostinger: 'composio',
  });
  assert.deepStrictEqual(p.flow, ['composio-connect', 'github', 'convex-cloud', 'vercel', 'hostinger-dns', 'verify']);
  assert.ok(p.executionSteps.every(x => x.engine === 'composio'));
  assert.strictEqual(p.executionSteps[1].toolkit, 'github');
});

test('SCPORT-2: hosted runtime is blocked without Composio instead of falling back to SC', () => {
  const p = planDeploy({ runtime: 'hosted', env: {}, composioAvailable: false });
  assert.strictEqual(p.route, 'hosted-managed');
  assert.strictEqual(p.ready, false);
  assert.strictEqual(p.composioRequired, true);
  assert.strictEqual(p.blockedBy[0].capability, 'composio');
  for (const x of p.providerRouting) assert.strictEqual(x.backend, 'composio');
});

test('SCPORT-3: hosted explicit VPS request is blocked rather than silently changed to Vercel', () => {
  const p = planDeploy({ runtime: 'hosted', requestedTarget: 'vps', composioAvailable: true });
  assert.strictEqual(p.route, 'hosted-vps-unsupported');
  assert.strictEqual(p.target, 'dokploy');
  assert.strictEqual(p.ready, false);
  assert.strictEqual(p.blockedBy[0].capability, 'vps-runner');
});

test('SCPORT-4: local auto route asks VPS ownership when it cannot be inferred', () => {
  const p = planDeploy({ runtime: 'local', env: {}, composioAvailable: true });
  assert.strictEqual(p.runtime, 'local');
  assert.strictEqual(p.route, 'decision-required');
  assert.strictEqual(p.target, null);
  assert.strictEqual(p.decisionRequired.type, 'vps');
  assert.match(p.decisionRequired.prompt, /VPS/i);
  assert.deepStrictEqual(p.flow, ['ask-vps']);
});

test('SCPORT-5: local no-VPS route keeps GitHub in SC and prefers Composio for managed providers', () => {
  const p = planDeploy({ runtime: 'local', env: {}, composioAvailable: true, vpsAvailable: false });
  assert.strictEqual(p.route, 'managed');
  assert.strictEqual(p.target, 'vercel');
  assert.deepStrictEqual(routing(p), {
    github: 'sc', vercel: 'composio', convex: 'composio', hostinger: 'composio',
  });
});

test('SCPORT-6: local VPS route can be inferred from Dokploy config and stays SC-controlled', () => {
  const p = planDeploy({ runtime: 'local', env: { DOKPLOY_API_URL: 'https://panel.test/api', DOKPLOY_API_KEY: 'x' }, composioAvailable: false });
  assert.strictEqual(p.route, 'vps');
  assert.strictEqual(p.target, 'dokploy');
  assert.strictEqual(routing(p).github, 'sc');
  assert.strictEqual(routing(p).dokploy, 'sc');
  assert.strictEqual(routing(p).convex, 'sc');
});

test('SCPORT-7: sc deploy plan exposes no credential values in hosted mode', () => {
  const secret = 'SHOULD_NEVER_APPEAR_PORTABLE';
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'deploy', 'plan', '--runtime', 'hosted', '--composio', '--json'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: secret, DOKPLOY_API_KEY: secret },
  });
  assert.doesNotMatch(out, new RegExp(secret));
  const j = JSON.parse(out);
  assert.strictEqual(j.route, 'hosted-managed');
  assert.strictEqual(j.providerRouting.find(x => x.provider === 'github').backend, 'composio');
});

test('SCPORT-8: Claude plugin manifest and MCP config stay portable', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  assert.strictEqual(plugin.name, 'si-coder');
  assert.strictEqual(plugin.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  const cfg = mcp.mcpServers['si-coder'];
  assert.ok(cfg.args.join(' ').includes('${CLAUDE_PLUGIN_ROOT}/scripts/sc-mcp.js'));
  assert.doesNotMatch(JSON.stringify(mcp), /(TOKEN|API_KEY|SECRET|PASSWORD)/i);
});

test('SCPORT-9: bundled MCP returns hosted full-Composio plan', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sc.deploy.plan', arguments: { runtime: 'hosted', composioAvailable: true } } },
  ];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT,
    env: { ...process.env, DOKPLOY_API_URL: '', DOKPLOY_API_KEY: '' },
    input: requests.map(x => JSON.stringify(x)).join('\n') + '\n',
    encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split(/\n/).map(JSON.parse);
  const list = rows.find(x => x.id === 2).result.tools;
  const deploy = list.find(x => x.name === 'sc.deploy.plan');
  assert.ok(deploy);
  assert.ok(deploy.inputSchema.properties.runtime);
  assert.ok(!list.some(x => /secret\.set/i.test(x.name)), 'MCP must not expose plaintext secret set');
  const plan = rows.find(x => x.id === 3).result.structuredContent;
  assert.strictEqual(plan.route, 'hosted-managed');
  assert.strictEqual(plan.providerRouting.find(x => x.provider === 'github').backend, 'composio');
});

test('SCPORT-9b: MCP supports 2026-07-28 server/discover and stateless tool calls without initialize', () => {
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: meta } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sc.version', arguments: {}, _meta: meta } },
  ];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split(/\n/).map(JSON.parse);
  const discover = rows.find(x => x.id === 1).result;
  assert.deepStrictEqual(discover.supportedVersions, ['2026-07-28']);
  assert.strictEqual(discover.resultType, 'complete');
  assert.strictEqual(discover._meta['io.modelcontextprotocol/serverInfo'].name, 'si-coder');
  const list = rows.find(x => x.id === 2).result;
  assert.ok(list.tools.some(x => x.name === 'sc.version'));
  assert.strictEqual(list.resultType, 'complete');
  assert.strictEqual(list.ttlMs, 0);
  assert.strictEqual(list.cacheScope, 'private');
  assert.strictEqual(list._meta['io.modelcontextprotocol/serverInfo'].name, 'si-coder');
  const call = rows.find(x => x.id === 3).result;
  assert.ok(call.structuredContent?.version);
  assert.strictEqual(call.resultType, 'complete');
  assert.strictEqual(call._meta['io.modelcontextprotocol/serverInfo'].name, 'si-coder');
});

test('SCPORT-9b2: modern MCP rejects unsupported per-request protocol with the standardized -32022 payload', () => {
  const request = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: {
    'io.modelcontextprotocol/protocolVersion': '2099-01-01',
    'io.modelcontextprotocol/clientCapabilities': {},
  } } };
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT, input: `${JSON.stringify(request)}\n`, encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const row = JSON.parse(r.stdout.trim());
  assert.strictEqual(row.error.code, -32022);
  assert.strictEqual(row.error.message, 'Unsupported protocol version');
  assert.deepStrictEqual(row.error.data, { supported: ['2026-07-28'], requested: '2099-01-01' });
});

test('SCPORT-9c: MCP keeps 2025 initialize compatibility while modern clients use discovery', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n', encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split(/\n/).map(JSON.parse);
  assert.strictEqual(rows.find(x => x.id === 1).result.protocolVersion, '2025-11-25');
  assert.ok(rows.find(x => x.id === 2).result.tools.length > 0);
  assert.ok(!rows.find(x => x.id === 2).result._meta, 'legacy responses should remain byte-shape compatible');
});

test('SCPORT-10: portable installer targets local Agent Skills runtimes from one SSOT', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-install-'));
  try {
    execFileSync('bash', [path.join(ROOT, 'install.sh'), '--agent', 'all', '--no-onboard'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, SC_SKIP_NPM_LINK: '1' },
    });
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills/catalog.json'), 'utf8')).skills;
    const active = Object.entries(catalog).filter(([, row]) => row.lifecycle === 'active' && row.installByDefault).map(([name]) => name);
    const inactive = Object.entries(catalog).filter(([, row]) => !(row.lifecycle === 'active' && row.installByDefault)).map(([name]) => name);
    for (const d of ['.claude/skills', '.agents/skills', '.hermes/skills', '.openclaw/workspace/skills']) {
      for (const skill of active) {
        const target = path.join(home, d, skill);
        assert.ok(fs.lstatSync(target).isSymbolicLink(), `${target} should be a symlink`);
        assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
      }
      for (const skill of inactive) {
        assert.ok(!fs.existsSync(path.join(home, d, skill)), `${skill} must not be installed by default`);
      }
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('SCPORT-10b: installer reports npm-link failure instead of silently claiming the CLI was linked', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-install-linkfail-'));
  const fakeBin = path.join(home, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const npm = path.join(fakeBin, 'npm');
  fs.writeFileSync(npm, '#!/bin/sh\necho "simulated npm link failure" >&2\nexit 42\n', { mode: 0o755 });
  try {
    const r = spawnSync('bash', [path.join(ROOT, 'install.sh'), '--agent', 'codex', '--no-onboard'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /could not link the global 'sc' command/i);
    assert.match(`${r.stdout}\n${r.stderr}`, /node .*bin\/sc\.js/);
    assert.ok(fs.existsSync(path.join(home, '.agents/skills/sc/SKILL.md')), 'skills still install even when optional npm link fails');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('SCPORT-10c: installer fails early on Node versions below the supported floor', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-install-node20-'));
  const fakeBin = path.join(home, 'bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  const node = path.join(fakeBin, 'node');
  fs.writeFileSync(node, '#!/bin/sh\nif [ "$1" = "-p" ]; then echo 20; else echo v20.99.0; fi\n', { mode: 0o755 });
  try {
    const r = spawnSync('bash', [path.join(ROOT, 'install.sh'), '--agent', 'codex', '--no-onboard'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${fakeBin}:${process.env.PATH}`, SC_SKIP_NPM_LINK: '1' },
    });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /requires Node\.js >=22/i);
    assert.ok(!fs.existsSync(path.join(home, '.agents/skills/sc')), 'unsupported runtime must fail before installation');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('SCPORT-11: machine deploy-plan schema exposes runtime but no secret-value fields', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'machine/functions.json'), 'utf8'));
  const fn = m.functions.find(x => x.name === 'sc.deploy.plan');
  assert.ok(fn);
  assert.deepStrictEqual(fn.inputSchema.properties.runtime.enum, ['auto', 'hosted', 'local']);
  const keys = JSON.stringify(m.functions.map(x => x.inputSchema));
  assert.doesNotMatch(keys, /"(value|secretValue|tokenValue|apiKeyValue|password)"\s*:/i);
});


test('SCPORT-12: userPlan is outcome-oriented and hides infrastructure jargon by default', () => {
  const hosted = planDeploy({ runtime: 'hosted', composioAvailable: true });
  const text = JSON.stringify(hosted.userPlan);
  assert.match(text, /web app|aplikasi|website/i);
  assert.doesNotMatch(text, /dokploy|convex|dns record|environment variable|deploy key|providerRouting|executionEngine/i);
  assert.strictEqual(hosted.userPlan.technicalDetailsOptional, true);
});

test('SCPORT-13: ambiguous local route asks a plain-language server choice', () => {
  const p = planDeploy({ runtime: 'local', env: {} });
  assert.strictEqual(p.userPlan.status, 'needs-answer');
  assert.match(p.userPlan.question, /server|hosting/i);
  assert.ok(p.userPlan.choices.some(x => /easiest/i.test(x.label)));
});

test('SCPORT-14: --with-mcp has native registration paths for Codex, Hermes, and OpenClaw', () => {
  const install = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
  assert.match(install, /codex mcp add si-coder -- node/);
  assert.match(install, /hermes mcp add si-coder --command node --args/);
  assert.match(install, /openclaw mcp add si-coder --command node --cwd/);
  assert.match(install, /scripts\/sc-mcp\.js/);
});
