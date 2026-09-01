const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { planDeploy } = require('../lib/deploy-route');

test('SCPORT-1: auto route selects VPS only when Dokploy is usable', () => {
  const vps = planDeploy({ env: { DOKPLOY_API_URL: 'https://panel.test/api', DOKPLOY_API_KEY: 'x' } });
  assert.strictEqual(vps.route, 'vps');
  assert.strictEqual(vps.target, 'dokploy');
  const managed = planDeploy({ env: {} });
  assert.strictEqual(managed.route, 'managed');
  assert.strictEqual(managed.target, 'vercel');
});

test('SCPORT-2: managed Composio routing keeps GitHub in SC', () => {
  const p = planDeploy({ env: {}, composioAvailable: true, vpsAvailable: false });
  const route = Object.fromEntries(p.providerRouting.map(x => [x.provider, x.backend]));
  assert.strictEqual(route.github, 'sc');
  assert.strictEqual(route.vercel, 'composio');
  assert.strictEqual(route.convex, 'composio');
  assert.strictEqual(route.hostinger, 'composio');
});

test('SCPORT-3: managed route falls back to SC when Composio is unavailable', () => {
  const p = planDeploy({ env: {}, composioAvailable: false, vpsAvailable: false });
  for (const x of p.providerRouting) assert.strictEqual(x.backend, 'sc');
});

test('SCPORT-4: sc deploy plan exposes no credential values', () => {
  const secret = 'SHOULD_NEVER_APPEAR_PORTABLE';
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'deploy', 'plan', '--no-vps', '--composio', '--json'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, GITHUB_TOKEN: secret, DOKPLOY_API_KEY: secret },
  });
  assert.doesNotMatch(out, new RegExp(secret));
  const j = JSON.parse(out);
  assert.strictEqual(j.route, 'managed');
});

test('SCPORT-5: Claude plugin manifest and MCP config use portable plugin paths', () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8'));
  const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
  assert.strictEqual(plugin.name, 'si-coder');
  assert.strictEqual(plugin.version, '0.5.0');
  const cfg = mcp.mcpServers['si-coder'];
  assert.ok(cfg.args.join(' ').includes('${CLAUDE_PLUGIN_ROOT}/scripts/sc-mcp.js'));
  assert.doesNotMatch(JSON.stringify(mcp), /(TOKEN|API_KEY|SECRET|PASSWORD)/i);
});

test('SCPORT-6: bundled MCP initializes, lists safe tools, and calls deploy planner', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'sc.deploy.plan', arguments: { target: 'managed', composioAvailable: true } } },
  ];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sc-mcp.js')], {
    cwd: ROOT,
    env: { ...process.env, DOKPLOY_API_URL: '', DOKPLOY_API_KEY: '' },
    input: requests.map(x => JSON.stringify(x)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split(/\n/).map(JSON.parse);
  const list = rows.find(x => x.id === 2).result.tools;
  assert.ok(list.some(x => x.name === 'sc.deploy.plan'));
  assert.ok(list.some(x => x.name === 'sc.secret.request'));
  assert.ok(!list.some(x => /secret\.set/i.test(x.name)), 'MCP must not expose plaintext secret set');
  const plan = rows.find(x => x.id === 3).result.structuredContent;
  assert.strictEqual(plan.route, 'managed');
  assert.strictEqual(plan.providerRouting.find(x => x.provider === 'github').backend, 'sc');
});

test('SCPORT-7: portable installer targets Claude/Codex/Hermes/OpenClaw from one skills SSOT', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-install-'));
  try {
    execFileSync('bash', [path.join(ROOT, 'install.sh'), '--agent', 'all', '--no-onboard'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home, SC_SKIP_NPM_LINK: '1' },
    });
    const dirs = [
      '.claude/skills', '.agents/skills', '.hermes/skills', '.openclaw/workspace/skills',
    ];
    for (const d of dirs) {
      for (const skill of ['sc-all', 'sc-provider', 'sc-install']) {
        const target = path.join(home, d, skill);
        assert.ok(fs.lstatSync(target).isSymbolicLink(), `${target} should be a symlink`);
        assert.ok(fs.existsSync(path.join(target, 'SKILL.md')));
      }
    }
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('SCPORT-8: MSO manifest exposes deploy plan without secret-value input fields', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, '.mso/functions.json'), 'utf8'));
  const fn = m.functions.find(x => x.name === 'sc.deploy.plan');
  assert.ok(fn);
  const keys = JSON.stringify(m.functions.map(x => x.inputSchema));
  assert.doesNotMatch(keys, /"(value|secretValue|tokenValue|apiKeyValue|password)"\s*:/i);
});
