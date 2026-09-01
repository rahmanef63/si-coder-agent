// deploy-route.js — pure route planner for the portable sc-all skill.
// No network calls and no credential values. It only reasons over presence/status.

const MANAGED_PROVIDER_POLICY = Object.freeze({
  github: 'sc',
  vercel: 'composio-preferred',
  convex: 'composio-preferred',
  hostinger: 'composio-preferred',
});

const VPS_PROVIDER_POLICY = Object.freeze({
  github: 'sc',
  dokploy: 'sc',
  convex: 'sc',
  hostinger: 'composio-or-sc',
});

function bool(v) {
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|on)$/i.test(String(v || ''));
}

function present(env, key) { return Boolean(env && env[key]); }

function normalizeRequestedTarget(v) {
  const s = String(v || 'auto').toLowerCase();
  if (!['auto', 'vps', 'managed', 'dokploy', 'hybrid', 'vercel'].includes(s)) {
    throw new Error(`unknown deploy target ${JSON.stringify(v)} (expected auto|vps|managed|dokploy|hybrid|vercel)`);
  }
  return s;
}

function planDeploy({ requestedTarget = 'auto', env = {}, composioAvailable = false, vpsAvailable } = {}) {
  const requested = normalizeRequestedTarget(requestedTarget);
  const dokployCredentials = present(env, 'DOKPLOY_API_URL') && present(env, 'DOKPLOY_API_KEY');
  const vpsReady = vpsAvailable === undefined ? dokployCredentials : bool(vpsAvailable);
  const composio = bool(composioAvailable);

  let route;
  if (requested === 'auto') route = vpsReady ? 'vps' : 'managed';
  else if (requested === 'vps' || requested === 'dokploy' || requested === 'hybrid') route = 'vps';
  else route = 'managed';

  let target;
  if (requested === 'hybrid') target = 'hybrid';
  else if (route === 'vps') target = 'dokploy';
  else target = 'vercel';

  const providerPolicy = route === 'managed' ? MANAGED_PROVIDER_POLICY : VPS_PROVIDER_POLICY;
  const providers = Object.entries(providerPolicy).map(([provider, policy]) => {
    let backend = 'sc';
    if (policy === 'composio-preferred') backend = composio ? 'composio' : 'sc';
    if (policy === 'composio-or-sc') backend = composio ? 'composio' : 'sc';
    return { provider, backend, policy };
  });

  const prerequisites = [];
  prerequisites.push({ provider: 'github', backend: 'sc', reason: 'repo creation/push identity stays deterministic and local' });
  if (route === 'vps') {
    prerequisites.push({ provider: 'dokploy', backend: 'sc', reason: 'VPS control-plane credentials are required for Dokploy' });
    if (target === 'hybrid') prerequisites.push({ provider: 'convex', backend: composio ? 'composio' : 'sc', reason: 'managed Convex backend' });
    prerequisites.push({ provider: 'hostinger', backend: composio ? 'composio' : 'sc', optional: true, reason: 'DNS automation' });
  } else {
    prerequisites.push({ provider: 'vercel', backend: composio ? 'composio' : 'sc', reason: 'managed frontend/deployment' });
    prerequisites.push({ provider: 'convex', backend: composio ? 'composio' : 'sc', reason: 'managed backend/control plane' });
    prerequisites.push({ provider: 'hostinger', backend: composio ? 'composio' : 'sc', reason: 'custom-domain DNS' });
  }

  return {
    requestedTarget: requested,
    route,
    target,
    reason: requested === 'auto'
      ? (vpsReady ? 'Dokploy credentials/VPS capability detected' : 'no usable VPS/Dokploy capability detected; managed path selected')
      : `explicit ${requested} route`,
    vpsReady,
    composioAvailable: composio,
    providerRouting: providers,
    prerequisites,
    flow: route === 'vps'
      ? ['preflight', 'github', target === 'hybrid' ? 'convex-cloud' : 'convex-self-hosted', 'dokploy', 'hostinger-dns', 'verify']
      : ['preflight', 'github', 'convex-cloud', 'vercel', 'hostinger-dns', 'verify'],
  };
}

module.exports = {
  MANAGED_PROVIDER_POLICY,
  VPS_PROVIDER_POLICY,
  normalizeRequestedTarget,
  planDeploy,
};
