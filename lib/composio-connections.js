'use strict';

// Composio connected-account control plane.
// Provider credentials (OAuth/access/refresh tokens, API keys entered into a Connect Link)
// stay in Composio. SI-Coder persists only safe routing identifiers + last-known status.
const C = require('./connections');
const { PROVIDERS } = require('./providers');

const BASE_URL = 'https://backend.composio.dev/api/v3.1';
const byId = new Map(PROVIDERS.map(p => [p.id, p]));

function provider(id) {
  const p = byId.get(id);
  if (!p) throw new Error(`unknown provider ${id}`);
  return p;
}

async function apiRequest(apiKey, pathname, { method = 'GET', body = null, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetchImpl(`${BASE_URL}${pathname}`, {
      method, headers, ...(body !== null ? { body: JSON.stringify(body) } : {}),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
    });
  } catch (e) {
    throw new Error(`Composio request failed${e?.name === 'TimeoutError' ? ': timeout' : ''}`);
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const code = json?.error?.code || json?.code || null;
    throw new Error(`Composio HTTP ${res.status}${code ? ` (${String(code).slice(0, 80)})` : ''}`);
  }
  return json || {};
}

function brokerContext(user, explicit = null) {
  const row = explicit ? C.get(user, 'composio', explicit) : C.selected(user, 'composio');
  if (!row) throw new Error(`no Composio project connection for user ${user}; add provider Composio with a project API key first`);
  if ((row.source || 'sc') !== 'sc' || row.authMethod !== 'project-api-key') {
    throw new Error(`Composio broker connection ${row.id} must be SI-Coder direct / project-api-key`);
  }
  const values = C.readValues(user, 'composio', row.id);
  if (!values.COMPOSIO_API_KEY) throw new Error(`Composio project connection ${row.id} is missing COMPOSIO_API_KEY`);
  return { id: row.id, apiKey: values.COMPOSIO_API_KEY };
}

function safeAuthConfig(row) {
  return row ? {
    id: row.id || row.auth_config?.id || null,
    toolkit: row.toolkit?.slug || null,
    authScheme: row.auth_scheme || row.auth_config?.auth_scheme || null,
    isComposioManaged: Boolean(row.is_composio_managed ?? row.auth_config?.is_composio_managed),
    status: row.status || null,
  } : null;
}

async function getAuthConfig(apiKey, id, options = {}) {
  return safeAuthConfig(await apiRequest(apiKey, `/auth_configs/${encodeURIComponent(id)}`, options));
}

async function listAuthConfigs(apiKey, toolkit, { managed = null, fetchImpl = globalThis.fetch } = {}) {
  const qs = new URLSearchParams({ toolkit_slug: toolkit, show_disabled: 'false', limit: '50' });
  if (managed !== null) qs.set('is_composio_managed', managed ? 'true' : 'false');
  const out = await apiRequest(apiKey, `/auth_configs?${qs.toString()}`, { fetchImpl });
  return (Array.isArray(out.items) ? out.items : []).map(safeAuthConfig);
}

async function createManagedAuthConfig(apiKey, toolkit, { fetchImpl = globalThis.fetch } = {}) {
  const out = await apiRequest(apiKey, '/auth_configs', {
    method: 'POST', body: { toolkit: { slug: toolkit } }, fetchImpl,
  });
  const row = safeAuthConfig({ ...out.auth_config, toolkit: out.toolkit });
  if (!row?.id) throw new Error('Composio created an auth config without an id');
  return row;
}

async function chooseAuthConfig({ apiKey, providerRow, connection, preferredId = null, fetchImpl = globalThis.fetch }) {
  const source = C.sourceOption(providerRow, 'composio');
  const method = C.authOption(providerRow, 'composio', connection.authMethod);
  const toolkit = connection.external?.toolkit || source.toolkit || providerRow.id;
  const pinned = preferredId || connection.external?.authConfigId || null;
  if (pinned) {
    const row = await getAuthConfig(apiKey, pinned, { fetchImpl });
    if (row.toolkit && row.toolkit !== toolkit) throw new Error(`auth config ${pinned} belongs to toolkit ${row.toolkit}, not ${toolkit}`);
    if (row.authScheme && row.authScheme !== method.scheme) throw new Error(`auth config ${pinned} uses ${row.authScheme}, not ${method.scheme}`);
    if (row.status && row.status !== 'ENABLED') throw new Error(`auth config ${pinned} is ${row.status}`);
    return row;
  }

  const managedFilter = source.managedAuth ? true : null;
  let candidates = await listAuthConfigs(apiKey, toolkit, { managed: managedFilter, fetchImpl });
  candidates = candidates.filter(x => (!x.status || x.status === 'ENABLED') && (!x.authScheme || x.authScheme === method.scheme));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) throw new Error(`multiple ${toolkit}/${method.scheme} auth configs are available; pin one authConfigId explicitly`);
  if (!source.managedAuth) throw new Error(`no ${toolkit}/${method.scheme} auth config is available in the selected Composio project; create one in Composio first`);
  return createManagedAuthConfig(apiKey, toolkit, { fetchImpl });
}

function safeConnectedAccount(row) {
  if (!row) return null;
  return {
    connectedAccountId: row.id || row.connected_account_id || null,
    toolkit: row.toolkit?.slug || null,
    authConfigId: row.auth_config?.id || null,
    authScheme: row.authScheme || row.auth_scheme || row.auth_config?.auth_scheme || null,
    alias: row.alias || null,
    userId: row.user_id || null,
    status: row.status || null,
    updatedAt: row.updated_at || null,
  };
}

async function authorize(user, providerId, connectionId, { authConfigId = null, brokerConnection = null, callbackUrl = null, fetchImpl = globalThis.fetch } = {}) {
  const p = provider(providerId);
  const connection = C.get(user, providerId, connectionId);
  if (connection.source !== 'composio') throw new Error(`${providerId}/${connectionId} source is ${connection.source}; only Composio connections use Connect Link`);
  if (connection.external?.connectedAccountId) throw new Error(`${providerId}/${connectionId} already has a connected account id; sync status instead of creating another account implicitly`);
  const source = C.sourceOption(p, 'composio');
  const broker = brokerContext(user, brokerConnection || connection.external?.brokerConnection || null);
  const authConfig = await chooseAuthConfig({ apiKey: broker.apiKey, providerRow: p, connection, preferredId: authConfigId, fetchImpl });
  const alias = connection.external?.alias || connection.id;
  const body = { auth_config_id: authConfig.id, user_id: user, alias };
  if (callbackUrl) {
    let parsed;
    try { parsed = new URL(callbackUrl); } catch { throw new Error('callbackUrl must be a valid public HTTPS URL'); }
    if (parsed.protocol !== 'https:') throw new Error('callbackUrl must use https');
    body.callback_url = parsed.toString();
  }
  const linked = await apiRequest(broker.apiKey, '/connected_accounts/link', { method: 'POST', body, fetchImpl });
  const connectedAccountId = linked.connected_account_id || linked.id || null;
  if (!connectedAccountId || !linked.redirect_url) throw new Error('Composio Connect Link response is missing redirect_url or connected_account_id');
  const checkedAt = new Date().toISOString();
  const updated = C.setExternal(user, providerId, connectionId, {
    system: 'composio', brokerConnection: broker.id, toolkit: source.toolkit || providerId,
    connectedAccountId, alias, authConfigId: authConfig.id,
    lastKnownStatus: 'INITIALIZING', checkedAt,
    ...(linked.expires_at ? { authLinkExpiresAt: linked.expires_at } : {}),
  });
  // link_token is intentionally discarded here and never enters SI-Coder metadata/output.
  return {
    user, provider: providerId, connection: updated.id, source: 'composio',
    redirectUrl: linked.redirect_url, expiresAt: linked.expires_at || null,
    connectedAccountId, authConfigId: authConfig.id, alias,
    status: 'INITIALIZING', brokerConnection: broker.id,
  };
}

async function sync(user, providerId, connectionId, { fetchImpl = globalThis.fetch } = {}) {
  const connection = C.get(user, providerId, connectionId);
  if (connection.source !== 'composio') throw new Error(`${providerId}/${connectionId} is not a Composio connection`);
  const ext = connection.external || {};
  if (!ext.connectedAccountId) throw new Error(`${providerId}/${connectionId} has no connected account id; authorize it first`);
  const broker = brokerContext(user, ext.brokerConnection || null);
  const raw = await apiRequest(broker.apiKey, `/connected_accounts/${encodeURIComponent(ext.connectedAccountId)}`, { fetchImpl });
  const safe = safeConnectedAccount(raw);
  if (safe.toolkit && ext.toolkit && safe.toolkit !== ext.toolkit) throw new Error(`connected account toolkit mismatch: expected ${ext.toolkit}, got ${safe.toolkit}`);
  const checkedAt = new Date().toISOString();
  const updated = C.setExternal(user, providerId, connectionId, {
    system: 'composio', brokerConnection: broker.id,
    toolkit: safe.toolkit || ext.toolkit || providerId,
    connectedAccountId: safe.connectedAccountId || ext.connectedAccountId,
    alias: safe.alias || ext.alias || connection.id,
    authConfigId: safe.authConfigId || ext.authConfigId || null,
    lastKnownStatus: safe.status || 'UNKNOWN', checkedAt,
  });
  return {
    user, provider: providerId, connection: updated.id, source: 'composio',
    connectedAccountId: updated.external?.connectedAccountId || null,
    authConfigId: updated.external?.authConfigId || null,
    alias: updated.external?.alias || null,
    toolkit: updated.external?.toolkit || null,
    status: updated.external?.lastKnownStatus || 'UNKNOWN', checkedAt,
  };
}

module.exports = {
  BASE_URL, apiRequest, brokerContext, safeAuthConfig, listAuthConfigs, createManagedAuthConfig,
  chooseAuthConfig, safeConnectedAccount, authorize, sync,
};
