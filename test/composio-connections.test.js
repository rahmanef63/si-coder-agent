// Composio control-plane tests use a sandbox config and mocked HTTP only.
const os = require('os');
const path = require('path');
const fs = require('fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-composio-'));
process.env.SC_CONFIG_DIR = SANDBOX;

const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/profiles');
const C = require('../lib/connections');
const UC = require('../lib/user-control');
const CC = require('../lib/composio-connections');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}
function setup() {
  P.writeProfile('agent', {});
  C.create('agent', 'composio', { id: 'project', label: 'Composio Project', source: 'sc', authMethod: 'project-api-key', scope: 'project', setDefault: true });
  C.writeValues('agent', 'composio', 'project', { COMPOSIO_API_KEY: 'ak_mock_project_private' });
  C.create('agent', 'github', {
    id: 'work-github', label: 'Work GitHub', source: 'composio', authMethod: 'oauth2', scope: 'account', setDefault: true,
    external: { system: 'composio', toolkit: 'github', alias: 'work-github', lastKnownStatus: 'UNLINKED', checkedAt: null },
  });
}

test('CMP-1: managed OAuth authorize creates/reuses auth config, persists only safe ids, and discards link_token', async () => {
  setup();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    assert.strictEqual(init.headers['x-api-key'], 'ak_mock_project_private');
    if (url.includes('/auth_configs?')) return response(200, { items: [] });
    if (url.endsWith('/auth_configs') && init.method === 'POST') {
      assert.deepStrictEqual(JSON.parse(init.body), { toolkit: { slug: 'github' } });
      return response(201, { toolkit: { slug: 'github' }, auth_config: { id: 'ac_managed', auth_scheme: 'OAUTH2', is_composio_managed: true } });
    }
    if (url.endsWith('/connected_accounts/link')) {
      assert.deepStrictEqual(JSON.parse(init.body), { auth_config_id: 'ac_managed', user_id: 'agent', alias: 'work-github' });
      return response(201, {
        link_token: 'link_token_must_never_persist',
        redirect_url: 'https://auth.composio.test/connect/temporary',
        expires_at: '2026-09-02T15:30:00Z',
        connected_account_id: 'ca_work',
      });
    }
    throw new Error(`unexpected mock URL ${url}`);
  };

  const out = await CC.authorize('agent', 'github', 'work-github', { fetchImpl });
  assert.strictEqual(out.connectedAccountId, 'ca_work');
  assert.strictEqual(out.authConfigId, 'ac_managed');
  assert.strictEqual(out.redirectUrl, 'https://auth.composio.test/connect/temporary');
  assert.strictEqual(calls.length, 3);
  const meta = fs.readFileSync(C.CONNECTION_META, 'utf8');
  assert.match(meta, /ca_work/);
  assert.match(meta, /ac_managed/);
  assert.match(meta, /\"brokerConnection\": \"project\"/);
  assert.doesNotMatch(meta, /link_token_must_never_persist/);
  assert.doesNotMatch(meta, /auth\.composio\.test\/connect\/temporary/);
  assert.doesNotMatch(meta, /ak_mock_project_private/);
  assert.strictEqual(UC.connectionStatus('agent', 'github', 'work-github').state, 'connecting');
});

test('CMP-2: status sync strips Composio credential state before output or persistence', async () => {
  const fetchImpl = async (url, init = {}) => {
    assert.match(url, /\/connected_accounts\/ca_work$/);
    assert.strictEqual(init.headers['x-api-key'], 'ak_mock_project_private');
    return response(200, {
      toolkit: { slug: 'github' },
      auth_config: { id: 'ac_managed', auth_scheme: 'OAUTH2', is_composio_managed: true },
      id: 'ca_work', alias: 'work-github', user_id: 'agent', status: 'ACTIVE', updated_at: '2026-09-02T15:31:00Z',
      state: { authScheme: 'OAUTH2', val: { access_token: 'must-never-escape', refresh_token: 'also-private' } },
    });
  };
  const out = await CC.sync('agent', 'github', 'work-github', { fetchImpl });
  assert.strictEqual(out.status, 'ACTIVE');
  assert.strictEqual(UC.connectionStatus('agent', 'github', 'work-github').state, 'active');
  const serialized = JSON.stringify(out) + fs.readFileSync(C.CONNECTION_META, 'utf8');
  assert.doesNotMatch(serialized, /must-never-escape|also-private|access_token|refresh_token/i);
});

test('CMP-3: auth-config ambiguity is refused instead of selecting the wrong Composio project config', async () => {
  C.create('agent', 'github', {
    id: 'client-github', label: 'Client GitHub', source: 'composio', authMethod: 'oauth2', scope: 'account',
    external: { system: 'composio', toolkit: 'github', alias: 'client-github', lastKnownStatus: 'UNLINKED' },
  });
  const fetchImpl = async url => {
    if (url.includes('/auth_configs?')) return response(200, { items: [
      { id: 'ac_one', toolkit: { slug: 'github' }, auth_scheme: 'OAUTH2', is_composio_managed: true, status: 'ENABLED' },
      { id: 'ac_two', toolkit: { slug: 'github' }, auth_scheme: 'OAUTH2', is_composio_managed: true, status: 'ENABLED' },
    ] });
    throw new Error('unexpected call');
  };
  await assert.rejects(() => CC.authorize('agent', 'github', 'client-github', { fetchImpl }), /multiple github\/OAUTH2 auth configs/);
  assert.strictEqual(C.get('agent', 'github', 'client-github').external.connectedAccountId, undefined);
});

test('CMP-4: external account cannot authorize without a user-owned Composio project connection', async () => {
  P.writeProfile('no-broker', {});
  C.create('no-broker', 'github', {
    id: 'work', label: 'Work', source: 'composio', authMethod: 'oauth2', scope: 'account',
    external: { system: 'composio', toolkit: 'github', alias: 'work', lastKnownStatus: 'UNLINKED' },
  });
  await assert.rejects(() => CC.authorize('no-broker', 'github', 'work', { fetchImpl: async () => { throw new Error('must not call network'); } }), /no Composio project connection/);
});
