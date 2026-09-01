// deploy-route.js — pure runtime + deployment route planner for portable sc-all.
// No network calls and no credential values. It only reasons over runtime/capability state.
const { userPlanForDeploy } = require('./user-facing');

const HOSTED_PROVIDER_POLICY = Object.freeze({
  github: 'composio-required',
  vercel: 'composio-required',
  convex: 'composio-required',
  hostinger: 'composio-required',
});

const LOCAL_MANAGED_PROVIDER_POLICY = Object.freeze({
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

function normalizeRuntime(v) {
  const raw = String(v || 'auto').toLowerCase();
  const aliases = { web: 'hosted', chat: 'hosted', cloud: 'hosted', desktop: 'local', cli: 'local' };
  const s = aliases[raw] || raw;
  if (!['auto', 'hosted', 'local'].includes(s)) {
    throw new Error(`unknown runtime ${JSON.stringify(v)} (expected auto|hosted|local)`);
  }
  return s;
}

function normalizeRequestedTarget(v) {
  const s = String(v || 'auto').toLowerCase();
  if (!['auto', 'vps', 'managed', 'dokploy', 'hybrid', 'vercel'].includes(s)) {
    throw new Error(`unknown deploy target ${JSON.stringify(v)} (expected auto|vps|managed|dokploy|hybrid|vercel)`);
  }
  return s;
}

function backendFor(policy, composio) {
  if (policy === 'composio-required') return 'composio';
  if (policy === 'composio-preferred' || policy === 'composio-or-sc') return composio ? 'composio' : 'sc';
  return 'sc';
}

function finalizePlan(plan) {
  return {
    ...plan,
    userPlan: userPlanForDeploy(plan),
    presentation: { defaultField: 'userPlan', technicalDetails: 'opt-in' },
  };
}

function planDeploy({ runtime = 'auto', requestedTarget = 'auto', env = {}, composioAvailable = false, vpsAvailable } = {}) {
  const requested = normalizeRequestedTarget(requestedTarget);
  const envRuntime = env.SC_RUNTIME ? normalizeRuntime(env.SC_RUNTIME) : 'auto';
  const normalizedRuntime = normalizeRuntime(runtime);
  const resolvedRuntime = normalizedRuntime === 'auto' ? (envRuntime === 'auto' ? 'local' : envRuntime) : normalizedRuntime;
  const composio = bool(composioAvailable);
  const dokployCredentials = present(env, 'DOKPLOY_API_URL') && present(env, 'DOKPLOY_API_KEY');

  // Hosted agents (Claude Web, ChatGPT-style chats, other server-side agent hosts) have no
  // local SC vault/CLI assumption. They skip VPS discovery entirely and orchestrate connected
  // accounts through Composio. If Composio is unavailable, the plan is blocked rather than
  // leaking back to a nonexistent local secret path.
  if (resolvedRuntime === 'hosted') {
    if (['vps', 'dokploy', 'hybrid'].includes(requested)) {
      return finalizePlan({
        runtime: 'hosted',
        requestedTarget: requested,
        route: 'hosted-vps-unsupported',
        target: requested === 'hybrid' ? 'hybrid' : 'dokploy',
        reason: 'hosted agent runtime has no local/VPS runner; explicit VPS deployment needs a connected runner or local SI-Coder runtime',
        decisionRequired: null,
        vpsReady: false,
        composioAvailable: composio,
        composioRequired: false,
        ready: false,
        blockedBy: [{ capability: 'vps-runner', action: 'connect-or-run-locally', reason: 'Dokploy/VPS operations need an execution host' }],
        providerRouting: [],
        prerequisites: [],
        executionEngine: 'blocked',
        connectorToolkits: [],
        executionSteps: [{ id: 'connect-vps-runner', engine: 'agent', goal: 'connect a VPS runner/MCP or continue from a local SI-Coder runtime' }],
        flow: ['connect-vps-runner'],
      });
    }
    const providers = Object.entries(HOSTED_PROVIDER_POLICY).map(([provider, policy]) => ({
      provider, backend: 'composio', policy,
    }));
    return finalizePlan({
      runtime: 'hosted',
      requestedTarget: requested,
      route: 'hosted-managed',
      target: 'vercel',
      reason: 'hosted agent runtime: skip VPS/local-vault probing and use connected Composio accounts',
      decisionRequired: null,
      vpsReady: false,
      composioAvailable: composio,
      composioRequired: true,
      ready: composio,
      blockedBy: composio ? [] : [{ capability: 'composio', action: 'connect', reason: 'hosted deployment requires connected provider accounts' }],
      providerRouting: providers,
      prerequisites: providers.map(({ provider, backend }) => ({ provider, backend, reason: 'hosted connected-account execution' })),
      executionEngine: 'composio',
      connectorToolkits: ['github', 'convex', 'vercel', 'hostinger'],
      executionSteps: [
        { id: 'connect', engine: 'composio', toolkits: ['github', 'convex', 'vercel', 'hostinger'], goal: 'ensure required connected accounts are active' },
        { id: 'github', engine: 'composio', toolkit: 'github', goal: 'create or reuse the repository and publish the intended source' },
        { id: 'convex', engine: 'composio', toolkit: 'convex', goal: 'create or reuse the production Convex Cloud backend' },
        { id: 'vercel', engine: 'composio', toolkit: 'vercel', goal: 'create or reuse the Vercel project, deploy production, and attach the canonical domain' },
        { id: 'dns', engine: 'composio', toolkit: 'hostinger', goal: 'validate and apply the DNS records required by the deployment target' },
        { id: 'verify', engine: 'composio', toolkits: ['vercel', 'hostinger'], goal: 'verify deployment state, domain attachment, DNS, HTTPS, and public reachability' },
      ],
      flow: ['composio-connect', 'github', 'convex-cloud', 'vercel', 'hostinger-dns', 'verify'],
    });
  }

  const explicitVps = typeof vpsAvailable === 'boolean' ? vpsAvailable : undefined;
  const detectedVps = explicitVps === undefined && dokployCredentials ? true : explicitVps;

  // On a local/CLI runtime the first real branch is ownership of a VPS. When neither the user
  // nor existing SC config answers it, do not guess "no VPS" — ask once before credential setup.
  if (requested === 'auto' && detectedVps === undefined) {
    return finalizePlan({
      runtime: 'local',
      requestedTarget: requested,
      route: 'decision-required',
      target: null,
      reason: 'local runtime: VPS ownership is not known yet',
      decisionRequired: {
        type: 'vps',
        prompt: 'Do you have a VPS you want SI-Coder to deploy to?',
        yes: 'vps/dokploy',
        no: 'managed/vercel',
      },
      vpsReady: false,
      composioAvailable: composio,
      composioRequired: false,
      ready: false,
      blockedBy: [],
      providerRouting: [],
      prerequisites: [],
      executionEngine: 'decision',
      connectorToolkits: [],
      executionSteps: [{ id: 'ask-vps', engine: 'agent', goal: 'ask once whether the user has a VPS to use for deployment' }],
      flow: ['ask-vps'],
    });
  }

  let route;
  if (requested === 'auto') route = detectedVps ? 'vps' : 'managed';
  else if (requested === 'vps' || requested === 'dokploy' || requested === 'hybrid') route = 'vps';
  else route = 'managed';

  const target = requested === 'hybrid' ? 'hybrid' : route === 'vps' ? 'dokploy' : 'vercel';
  const providerPolicy = route === 'managed' ? LOCAL_MANAGED_PROVIDER_POLICY : VPS_PROVIDER_POLICY;
  const providers = Object.entries(providerPolicy).map(([provider, policy]) => ({
    provider, backend: backendFor(policy, composio), policy,
  }));

  const prerequisites = [{ provider: 'github', backend: 'sc', reason: 'local repo creation/push identity stays deterministic in SC' }];
  if (route === 'vps') {
    prerequisites.push({ provider: 'dokploy', backend: 'sc', reason: 'VPS control-plane credentials are required for Dokploy' });
    if (target === 'hybrid') prerequisites.push({ provider: 'convex', backend: composio ? 'composio' : 'sc', reason: 'managed Convex backend' });
    prerequisites.push({ provider: 'hostinger', backend: composio ? 'composio' : 'sc', optional: true, reason: 'DNS automation' });
  } else {
    prerequisites.push({ provider: 'vercel', backend: composio ? 'composio' : 'sc', reason: 'managed frontend/deployment' });
    prerequisites.push({ provider: 'convex', backend: composio ? 'composio' : 'sc', reason: 'managed backend/control plane' });
    prerequisites.push({ provider: 'hostinger', backend: composio ? 'composio' : 'sc', reason: 'custom-domain DNS' });
  }

  return finalizePlan({
    runtime: 'local',
    requestedTarget: requested,
    route,
    target,
    reason: requested === 'auto'
      ? (detectedVps ? 'local runtime + VPS/Dokploy capability selected' : 'local runtime + user selected no VPS; managed path selected')
      : `local runtime + explicit ${requested} route`,
    decisionRequired: null,
    vpsReady: Boolean(detectedVps),
    composioAvailable: composio,
    composioRequired: false,
    ready: true,
    blockedBy: [],
    providerRouting: providers,
    prerequisites,
    executionEngine: route === 'vps' ? 'sc' : (composio ? 'mixed' : 'sc'),
    connectorToolkits: composio ? (route === 'vps' ? ['hostinger'] : ['vercel', 'convex', 'hostinger']) : [],
    executionSteps: route === 'vps'
      ? [
          { id: 'github', engine: 'sc', goal: 'create or reuse repository and push source' },
          { id: target === 'hybrid' ? 'convex-cloud' : 'convex-self-hosted', engine: target === 'hybrid' && composio ? 'composio' : 'sc', goal: 'prepare backend' },
          { id: 'dokploy', engine: 'sc', goal: 'deploy frontend/application on VPS' },
          { id: 'dns', engine: composio ? 'composio' : 'sc', goal: 'configure canonical domain DNS' },
          { id: 'verify', engine: 'agent', goal: 'verify backend, frontend, DNS and HTTPS' },
        ]
      : [
          { id: 'github', engine: 'sc', goal: 'create or reuse repository and push source' },
          { id: 'convex-cloud', engine: composio ? 'composio' : 'sc', goal: 'prepare managed backend' },
          { id: 'vercel', engine: composio ? 'composio' : 'sc', goal: 'deploy managed frontend and attach domain' },
          { id: 'dns', engine: composio ? 'composio' : 'sc', goal: 'configure canonical domain DNS' },
          { id: 'verify', engine: 'agent', goal: 'verify deployment, DNS and HTTPS' },
        ],
    flow: route === 'vps'
      ? ['preflight', 'github', target === 'hybrid' ? 'convex-cloud' : 'convex-self-hosted', 'dokploy', 'hostinger-dns', 'verify']
      : ['preflight', 'github', 'convex-cloud', 'vercel', 'hostinger-dns', 'verify'],
  });
}

module.exports = {
  HOSTED_PROVIDER_POLICY,
  LOCAL_MANAGED_PROVIDER_POLICY,
  VPS_PROVIDER_POLICY,
  normalizeRuntime,
  normalizeRequestedTarget,
  planDeploy,
};
