// providers.js — THE single source of truth for every credential si-coder needs.
//
// Why this file exists: the registry used to live as three parallel objects in
// skills/sc-onboarding/lib/onboarding-domains.js (DOMAIN_VARS + VALIDATORS +
// SECRET_SOURCES). Keeping three maps in sync by hand is exactly the kind of drift a
// registry is supposed to prevent, and it had already drifted both ways — CLOUDFLARE_ZONE_ID
// and DOKPLOY_PUBLIC_IP were read by code but never collected, while CLOUDFLARE_ACCOUNT_ID
// was collected but read by nothing.
//
// Here each var carries its own required/secret/source/validator inline, so the three legacy
// maps are DERIVED and cannot drift again. onboarding-domains.js re-exports them unchanged,
// so every existing caller and test keeps working.
//
// A provider also carries `check` — a LIVE probe against the real API. Format validation
// answers "does this look like a token"; only a live probe answers "does this token work,
// and against which account". That distinction is the whole point of `sc doctor`.

// ---------------------------------------------------------------------------
// tiny fetch helper — bounded, never throws, never leaks the token into output
// ---------------------------------------------------------------------------
async function probe(url, { headers = {}, timeoutMs = 12000, method = 'GET' } = {}) {
  try {
    const res = await fetch(url, { method, headers, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON is fine */ }
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    return { status: 0, ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

const ok   = (detail) => ({ ok: true,  detail });
const bad  = (detail) => ({ ok: false, detail });
const skip = (detail) => ({ ok: null,  detail }); // no live check possible — not a failure

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
const PROVIDERS = [
  {
    id: 'github',
    title: 'GitHub',
    blurb: 'repo create + push (required for any deploy)',
    status: 'implemented',
    vars: [
      { key: 'GITHUB_TOKEN', required: true, secret: true,
        url: 'https://github.com/settings/tokens/new', note: 'scope: repo (full)',
        validate: v => (v.startsWith('ghp_') || v.startsWith('github_pat_')) && v.length >= 40 },
      { key: 'GH_OWNER', required: false, secret: false,
        note: 'GitHub user/org that owns the repos (defaults to the token owner)',
        validate: v => /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(v) },
    ],
    async check(env) {
      if (!env.GITHUB_TOKEN) return skip('GITHUB_TOKEN not set');
      const r = await probe('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 'si-coder' },
      });
      if (r.status === 401) return bad('token rejected (401) — expired or revoked');
      if (!r.ok) return bad(`HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`);
      return ok(`authenticated as ${r.body?.login}`);
    },
  },

  {
    id: 'dokploy',
    title: 'Dokploy',
    blurb: 'Dokploy CRUD + the dokploy/hybrid deploy targets',
    status: 'implemented',
    vars: [
      { key: 'DOKPLOY_API_URL', required: true, secret: false,
        note: 'your Dokploy panel URL + /api, e.g. https://panel.example.com/api',
        // http://127.0.0.1:3000/api is the normal local shape, so https cannot be demanded.
        validate: v => /^https?:\/\/.+/.test(v) && v.endsWith('/api') },
      { key: 'DOKPLOY_API_KEY', required: true, secret: true,
        url: '<your Dokploy panel>/dashboard/settings/profile', note: 'API/CLI section → Generate',
        validate: v => v.length >= 24 },
      { key: 'DOKPLOY_PUBLIC_IP', required: false, secret: false,
        note: "the VPS's PUBLIC IPv4 — what A records must point at. Never derive this from DOKPLOY_API_URL: a local panel URL resolves to 127.0.0.1 and publishes loopback DNS",
        validate: v => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) },
    ],
    async check(env) {
      if (!env.DOKPLOY_API_URL || !env.DOKPLOY_API_KEY) return skip('DOKPLOY_API_URL/KEY not set');
      const r = await probe(`${env.DOKPLOY_API_URL}/project.all`, {
        headers: { 'x-api-key': env.DOKPLOY_API_KEY },
      });
      if (r.status === 401) return bad('API key rejected (401) — wrong key, or key from a DIFFERENT Dokploy box');
      if (!r.ok) return bad(`HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`);
      const n = Array.isArray(r.body) ? r.body.length : 0;
      return ok(`reachable, ${n} project(s)`);
    },
  },

  {
    id: 'convex',
    title: 'Convex (self-hosted)',
    blurb: 'self-hosted Convex on Dokploy compose',
    status: 'implemented',
    vars: [
      { key: 'CONVEX_ADMIN_KEY', required: false, secret: true,
        note: 'auto-generated by /sc-convex on deploy — usually leave blank',
        validate: v => v.includes('|') && v.length >= 32 },
    ],
    async check() { return skip('generated at deploy time — nothing to verify up front'); },
  },

  {
    id: 'convex-cloud',
    title: 'Convex Cloud',
    blurb: 'managed Convex backend (hybrid + vercel targets)',
    status: 'implemented',
    vars: [
      { key: 'CONVEX_DEPLOY_KEY', required: true, secret: true,
        url: 'https://dashboard.convex.dev/deployment/settings',
        note: 'production deployment → Generate Production Deploy Key',
        validate: v => v.includes('|') && /^(prod|preview|project):/.test(v) && v.length >= 32 },
      { key: 'CONVEX_DEPLOYMENT', required: false, secret: false,
        note: 'written by `npx convex dev`; leave blank for CI',
        validate: v => v.length >= 6 },
    ],
    async check(env) {
      if (!env.CONVEX_DEPLOY_KEY) return skip('CONVEX_DEPLOY_KEY not set');
      // A prod deploy key embeds its deployment name before the '|'. Verifying the key itself
      // needs the convex CLI + a project on disk, so check the shape and report the target.
      const name = String(env.CONVEX_DEPLOY_KEY).split('|')[0];
      return skip(`key targets "${name}" — live verify needs \`npx convex deploy\` in a project`);
    },
  },

  {
    id: 'hostinger',
    title: 'Hostinger',
    blurb: 'DNS automation for zones delegated to Hostinger (ns*.dns-parking.com)',
    status: 'implemented',
    vars: [
      { key: 'HOSTINGER_API_TOKEN', required: false, secret: true,
        url: 'https://hpanel.hostinger.com/profile/api',
        validate: v => v.length >= 32 },
    ],
    async check(env) {
      if (!env.HOSTINGER_API_TOKEN) return skip('HOSTINGER_API_TOKEN not set');
      const r = await probe('https://developers.hostinger.com/api/vps/v1/virtual-machines', {
        headers: { Authorization: `Bearer ${env.HOSTINGER_API_TOKEN}` },
      });
      if (r.status === 401) return bad('token rejected (401)');
      if (!r.ok) return bad(`HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`);
      const n = Array.isArray(r.body) ? r.body.length : 0;
      return ok(`token valid, ${n} VPS visible`);
    },
  },

  {
    id: 'cf',
    title: 'Cloudflare',
    blurb: 'DNS automation for zones delegated to Cloudflare',
    status: 'implemented',
    vars: [
      { key: 'CLOUDFLARE_API_TOKEN', required: false, secret: true,
        url: 'https://dash.cloudflare.com/profile/api-tokens',
        note: 'Zone:Read + Zone:DNS:Edit, scoped to your zone',
        validate: v => v.length >= 32 },
      { key: 'CLOUDFLARE_ZONE_ID', required: false, secret: false,
        url: 'https://dash.cloudflare.com',
        note: 'OPTIONAL zone pin. It SKIPS the zone-name lookup, so a stale value silently sends writes to the wrong zone. Do not export it globally — pass it per invocation',
        validate: v => /^[0-9a-f]{32}$/.test(v) },
      { key: 'CLOUDFLARE_ACCOUNT_ID', required: false, secret: false,
        url: 'https://dash.cloudflare.com', note: 'right sidebar → Account ID (not read by any sc-* script today)',
        validate: v => v.length >= 16 },
    ],
    async check(env) {
      if (!env.CLOUDFLARE_API_TOKEN) return skip('CLOUDFLARE_API_TOKEN not set');
      const v = await probe('https://api.cloudflare.com/client/v4/user/tokens/verify', {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      });
      if (v.status === 401 || v.status === 403) return bad(`token rejected (${v.status})`);
      if (!v.ok) return bad(`HTTP ${v.status}${v.error ? ` (${v.error})` : ''}`);
      const z = await probe('https://api.cloudflare.com/client/v4/zones?per_page=50', {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      });
      const zones = (z.body?.result || []).map(x => x.name);
      // Naming the zones is the point: it is how an operator sees at a glance that this token
      // cannot reach a zone belonging to someone else's account.
      return ok(`${v.body?.result?.status || 'active'}; ${zones.length} zone(s): ${zones.join(', ') || '—'}`);
    },
  },

  {
    id: 'vercel',
    title: 'Vercel',
    blurb: 'managed edge frontend (vercel target)',
    status: 'implemented',
    vars: [
      { key: 'VERCEL_TOKEN', required: true, secret: true,
        url: 'https://vercel.com/account/tokens', note: 'scope: Full Account',
        validate: v => v.length >= 24 },
      { key: 'VERCEL_TEAM_ID', required: false, secret: false,
        url: 'https://vercel.com/dashboard', note: 'Team → Settings → General → Team ID. Set it when the account has more than one team — a custom domain lives in exactly one, and cross-team calls 403',
        validate: v => v.length >= 8 },
    ],
    async check(env) {
      if (!env.VERCEL_TOKEN) return skip('VERCEL_TOKEN not set');
      const r = await probe('https://api.vercel.com/v2/user', {
        headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      });
      if (r.status === 401 || r.status === 403) return bad(`token rejected (${r.status})`);
      if (!r.ok) return bad(`HTTP ${r.status}${r.error ? ` (${r.error})` : ''}`);
      const who = r.body?.user?.username || r.body?.user?.email || 'unknown';
      const t = await probe('https://api.vercel.com/v2/teams', {
        headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      });
      const teams = (t.body?.teams || []).map(x => `${x.slug}=${x.id}`);
      let note = `authenticated as ${who}; teams: ${teams.join(', ') || '—'}`;
      if (teams.length > 1 && !env.VERCEL_TEAM_ID) note += '  ⚠️ more than one team and VERCEL_TEAM_ID is unset';
      return ok(note);
    },
  },

  {
    id: 'sync',
    title: 'Tailscale sync',
    blurb: 'rsync gitignored files between VPS and local over Tailscale',
    status: 'implemented',
    vars: [
      { key: 'SYNC_ROLE', required: true, secret: false,
        note: "this machine's role — exactly 'vps' or 'local'",
        validate: v => v === 'vps' || v === 'local' },
      { key: 'SYNC_VPS_TS_ADDR', required: true, secret: false,
        cmd: 'tailscale status   (or on the vps: tailscale ip -4)',
        validate: v => v.length > 0 && /^[a-zA-Z0-9.:_-]+$/.test(v) },
      { key: 'SYNC_LOCAL_TS_ADDR', required: true, secret: false,
        cmd: 'tailscale status   (or on local: tailscale ip -4)',
        validate: v => v.length > 0 && /^[a-zA-Z0-9.:_-]+$/.test(v) },
      { key: 'SYNC_REMOTE_USER', required: false, secret: false,
        note: 'ssh user on the other machine (defaults to the current user)',
        validate: v => v.length > 0 },
      { key: 'SYNC_REMOTE_PATH', required: false, secret: false,
        note: "repo path on the other machine (defaults to this machine's)",
        validate: v => v.length > 0 },
    ],
    async check(env) {
      if (!env.SYNC_ROLE) return skip('SYNC_ROLE not set');
      const peer = env.SYNC_ROLE === 'vps' ? env.SYNC_LOCAL_TS_ADDR : env.SYNC_VPS_TS_ADDR;
      if (!peer) return bad(`SYNC_ROLE=${env.SYNC_ROLE} but the peer address is unset`);
      return skip(`role=${env.SYNC_ROLE}, peer=${peer} — reachability is checked by /sc-sync at run time`);
    },
  },

  {
    id: 'git',
    title: 'sc-git runner',
    blurb: 'self-hosted GitHub Actions runner + webhook on the VPS',
    status: 'implemented',
    vars: [
      { key: 'SC_GIT_VPS_HOST', required: false, secret: false,
        note: 'host/IP of the VPS that runs the self-hosted runner',
        validate: v => v.length > 0 },
      { key: 'SC_GIT_WEBHOOK_SECRET', required: false, secret: true,
        note: 'shared secret for the GitHub webhook → VPS listener',
        validate: v => v.length >= 16 },
    ],
    async check() { return skip('verified by /sc-git when the runner is installed'); },
  },

  // ---- stubs: vars registered so onboarding can collect them; scripts not implemented ----
  {
    id: 'stripe', title: 'Stripe', blurb: 'payments (STUB — script not implemented)', status: 'stub',
    vars: [
      { key: 'STRIPE_SECRET_KEY', required: false, secret: true, url: 'https://dashboard.stripe.com/apikeys', validate: v => /^sk_(test|live)_/.test(v) },
      { key: 'STRIPE_PUBLISHABLE_KEY', required: false, secret: false, url: 'https://dashboard.stripe.com/apikeys', validate: v => /^pk_(test|live)_/.test(v) },
      { key: 'STRIPE_WEBHOOK_SECRET', required: false, secret: true, url: 'https://dashboard.stripe.com/webhooks', note: 'add endpoint → Signing secret (whsec_…)', validate: v => v.startsWith('whsec_') },
    ],
    async check() { return skip('stub — /sc-stripe not implemented'); },
  },
  {
    id: 'resend', title: 'Resend', blurb: 'transactional email (STUB)', status: 'stub',
    vars: [
      { key: 'RESEND_API_KEY', required: false, secret: true, url: 'https://resend.com/api-keys', validate: v => v.startsWith('re_') },
      { key: 'RESEND_FROM_DOMAIN', required: false, secret: false, url: 'https://resend.com/domains', note: 'a verified sender domain', validate: v => /\./.test(v) },
    ],
    async check() { return skip('stub — /sc-resend not implemented'); },
  },
  {
    id: 'clerk', title: 'Clerk', blurb: 'auth (STUB)', status: 'stub',
    vars: [
      { key: 'CLERK_SECRET_KEY', required: false, secret: true, url: 'https://dashboard.clerk.com', note: 'API Keys → Secret key', validate: v => /^sk_(test|live)_/.test(v) },
      { key: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', required: false, secret: false, url: 'https://dashboard.clerk.com', note: 'API Keys → Publishable key', validate: v => /^pk_(test|live)_/.test(v) },
      { key: 'NEXT_PUBLIC_CLERK_FRONTEND_API_URL', required: false, secret: false, url: 'https://dashboard.clerk.com', note: 'API Keys → Frontend API URL', validate: v => v.startsWith('https://') },
    ],
    async check() { return skip('stub — /sc-clerk not implemented'); },
  },
  {
    id: 'supabase', title: 'Supabase', blurb: 'Postgres backend (STUB)', status: 'stub',
    vars: [
      { key: 'SUPABASE_ACCESS_TOKEN', required: false, secret: true, url: 'https://supabase.com/dashboard/account/tokens', validate: v => v.startsWith('sbp_') },
      { key: 'SUPABASE_ORG_ID', required: false, secret: false, url: 'https://supabase.com/dashboard/org/_/general', validate: v => v.length >= 16 },
    ],
    async check() { return skip('stub — /sc-supabase not implemented'); },
  },
];

// ---------------------------------------------------------------------------
// Derived views — the legacy shapes, generated so they can never drift again
// ---------------------------------------------------------------------------
const byId = new Map(PROVIDERS.map(p => [p.id, p]));

const DOMAIN_VARS = Object.fromEntries(PROVIDERS.map(p => [p.id, {
  required: p.vars.filter(v => v.required).map(v => v.key),
  optional: p.vars.filter(v => !v.required).map(v => v.key),
}]));

const VALIDATORS = Object.fromEntries(
  PROVIDERS.flatMap(p => p.vars).filter(v => v.validate).map(v => [v.key, v.validate]),
);

const SECRET_SOURCES = Object.fromEntries(PROVIDERS.flatMap(p => p.vars).map(v => {
  const s = { secret: v.secret !== false };
  if (v.url) s.url = v.url;
  if (v.cmd) s.cmd = v.cmd;
  if (v.note) s.note = v.note;
  return [v.key, s];
}));

const DOMAIN_BLURBS = Object.fromEntries(PROVIDERS.map(p => [p.id, p.blurb]));

/** Every var record for a provider id, or [] for an unknown id. */
function varsOf(id) { return byId.get(id)?.vars || []; }

/** The provider record for a var key (used to group prompts and doctor output). */
function providerOfVar(key) { return PROVIDERS.find(p => p.vars.some(v => v.key === key)) || null; }

/** Provider ids required by a /sc-all --target. Keep in sync with skills/sc-all/SKILL.md. */
const TARGET_PROVIDERS = {
  dokploy: ['github', 'dokploy'],
  hybrid:  ['github', 'dokploy', 'convex-cloud'],
  vercel:  ['github', 'vercel', 'convex-cloud'],
};

module.exports = {
  PROVIDERS, TARGET_PROVIDERS,
  DOMAIN_VARS, VALIDATORS, SECRET_SOURCES, DOMAIN_BLURBS,
  varsOf, providerOfVar, probe,
};
