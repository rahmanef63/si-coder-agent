// Guards the "where do I get this secret" registry against drift: every var the
// onboarding wizard can collect must declare a source, and every source must be
// shaped so the wizard/scan-env can render a "get it here" line. If this fails,
// a var was added to DOMAIN_VARS without a SECRET_SOURCES entry (or vice versa).
const test = require('node:test');
const assert = require('node:assert');
const {
  DOMAIN_VARS, SECRET_SOURCES, isSecret, sourceLine,
} = require('../skills/sc-onboarding/lib/onboarding-domains');

const allVars = [
  ...new Set(
    Object.values(DOMAIN_VARS).flatMap(d => [...d.required, ...d.optional]),
  ),
];

test('SRC-1: every onboarding var has a SECRET_SOURCES entry', () => {
  const missing = allVars.filter(k => !SECRET_SOURCES[k]);
  assert.deepStrictEqual(missing, [], `vars without a source: ${missing.join(', ')}`);
});

test('SRC-2: no orphan SECRET_SOURCES entry (every one maps to a real var)', () => {
  const known = new Set(allVars);
  const orphans = Object.keys(SECRET_SOURCES).filter(k => !known.has(k));
  assert.deepStrictEqual(orphans, [], `sources with no matching var: ${orphans.join(', ')}`);
});

test('SRC-3: every entry can render a non-empty source line', () => {
  for (const k of allVars) {
    assert.ok(sourceLine(k).length > 0, `${k} produced an empty source line`);
  }
});

test('SRC-4: every source names a url, a cmd, or a note (never nothing)', () => {
  for (const [k, s] of Object.entries(SECRET_SOURCES)) {
    assert.ok(s.url || s.cmd || s.note, `${k} has neither url, cmd, nor note`);
  }
});

test('SRC-5: web URLs are https (a mistyped source is caught here)', () => {
  for (const [k, s] of Object.entries(SECRET_SOURCES)) {
    if (!s.url) continue;
    // A panel placeholder like "<your Dokploy panel>/..." is intentionally not a
    // literal URL; everything else must be https.
    if (s.url.startsWith('<')) continue;
    assert.ok(s.url.startsWith('https://'), `${k} url is not https: ${s.url}`);
  }
});

test('SRC-6: secrets default-closed — an unregistered var is treated as secret', () => {
  assert.strictEqual(isSecret('SOME_BRAND_NEW_KEY_NOT_REGISTERED'), true);
});

test('SRC-7: known non-secret public values are not hidden', () => {
  // These are safe to echo (public keys, URLs, ids) — hiding them would only annoy.
  for (const k of ['DOKPLOY_API_URL', 'VERCEL_TEAM_ID', 'STRIPE_PUBLISHABLE_KEY', 'SYNC_ROLE']) {
    assert.strictEqual(isSecret(k), false, `${k} should not be hidden`);
  }
});

test('SRC-8: token-shaped credentials are hidden', () => {
  for (const k of ['GITHUB_TOKEN', 'DOKPLOY_API_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'CONVEX_DEPLOY_KEY']) {
    assert.strictEqual(isSecret(k), true, `${k} must be hidden`);
  }
});


test('SRC-9: externally-created API/token credentials always declare a creation endpoint', () => {
  const external = allVars.filter(k => /(?:API_KEY|API_TOKEN|ACCESS_TOKEN|DEPLOY_KEY|SECRET_KEY|TOKEN)$/.test(k));
  const generatedLocally = new Set(['CONVEX_ADMIN_KEY', 'SC_GIT_WEBHOOK_SECRET']);
  for (const k of external) {
    if (generatedLocally.has(k)) continue;
    assert.ok(SECRET_SOURCES[k]?.url || SECRET_SOURCES[k]?.cmd, `${k} needs an explicit creation endpoint/command`);
  }
});

test('SRC-10: full credential guide says where to create, store, and continue', () => {
  const { credentialGuide, humanGuideLines } = require('../lib/credential-guidance');
  const g = credentialGuide('VERCEL_TOKEN');
  assert.match(g.createAt, /^https:\/\//);
  assert.strictEqual(g.saveWith, 'sc secret set vercel VERCEL_TOKEN');
  assert.match(g.saveDestination, /SC profile/);
  assert.strictEqual(g.continueWith, 'sc doctor --providers vercel');
  const text = humanGuideLines('VERCEL_TOKEN').join('\n');
  assert.match(text, /Create at/);
  assert.match(text, /Save with/);
  assert.match(text, /Stored in/);
  assert.match(text, /Continue/);
});


test('SRC-11: credential guide includes a non-technical user card', () => {
  const { credentialGuide } = require('../lib/credential-guidance');
  const g = credentialGuide('RESEND_API_KEY');
  assert.ok(g.userCard);
  assert.match(g.userCard.title, /access|email/i);
  assert.strictEqual(g.userCard.technicalDetailsOptional, true);
  assert.ok(g.userCard.primaryAction.url.startsWith('https://'));
});

test('SRC-12: every built-in dashboard URL has click-by-click navigation metadata', () => {
  const { PROVIDERS, BUILTIN_PROVIDER_IDS } = require('../lib/providers');
  for (const p of PROVIDERS.filter(row => BUILTIN_PROVIDER_IDS.includes(row.id))) {
    for (const v of p.vars) {
      if (!v.url) continue;
      assert.ok(Array.isArray(v.navigation) && v.navigation.length > 0,
        `${p.id}/${v.key} has a URL but no navigation steps`);
      assert.ok(v.navigation.every(step => typeof step === 'string' && step.trim()),
        `${p.id}/${v.key} has an invalid navigation step`);
    }
  }
});

test('SRC-13: credential guide returns reference URL plus navigation, or a local generation path', () => {
  const { credentialGuide, humanGuideLines } = require('../lib/credential-guidance');
  const github = credentialGuide('GITHUB_TOKEN', { user: 'alpha' });
  assert.strictEqual(github.referenceUrl, 'https://github.com/settings/tokens/new');
  assert.ok(github.navigation.length >= 3);
  assert.match(github.navigationText, /Tokens \(classic\)/i);
  assert.match(github.userCard.navigationText, /Generate token/i);
  assert.match(humanGuideLines('GITHUB_TOKEN', { user: 'alpha' }).join('\n'), /Navigate\s+:/);
  const githubProvider = require('../lib/providers').PROVIDERS.find(p => p.id === 'github');
  const classic = githubProvider.auth.find(a => a.id === 'classic-pat');
  assert.strictEqual(githubProvider.auth.length, 1, 'SC direct GitHub must expose PAT classic only');
  const classicGuide = credentialGuide('GITHUB_TOKEN', { user: 'alpha', override: classic.guidance.GITHUB_TOKEN });
  assert.strictEqual(classicGuide.referenceUrl, 'https://github.com/settings/tokens/new');
  assert.match(classicGuide.navigationText, /repo for private repository automation/i);
  assert.strictEqual(require('../lib/providers').VALIDATORS.GITHUB_TOKEN(`ghp_${'a'.repeat(40)}`), true);
  assert.strictEqual(require('../lib/providers').VALIDATORS.GITHUB_TOKEN(`github_pat_${'a'.repeat(48)}`), false);

  const webhook = credentialGuide('SC_GIT_WEBHOOK_SECRET', { user: 'alpha' });
  assert.strictEqual(webhook.referenceUrl, null);
  assert.match(webhook.createCommand, /openssl rand -hex 32/);
  assert.match(webhook.navigationText, /GitHub webhook Secret field/);
  assert.match(webhook.userCard.message, /locally/i);
});

test('SRC-14: Convex Cloud exposes separate account PAT and deployment-key connection methods', () => {
  const { PROVIDERS } = require('../lib/providers');
  const convex = PROVIDERS.find(p => p.id === 'convex-cloud');
  assert.ok(convex);
  assert.deepStrictEqual(convex.sources.composio.authSchemes, ['BEARER_TOKEN', 'API_KEY']);
  const pat = convex.auth.find(a => a.id === 'personal-access-token');
  const deployment = convex.auth.find(a => a.id === 'deployment-key');
  assert.strictEqual(pat.scheme, 'BEARER_TOKEN');
  assert.strictEqual(pat.scope, 'account');
  assert.deepStrictEqual(pat.requiredFields, ['CONVEX_PERSONAL_ACCESS_TOKEN']);
  assert.strictEqual(deployment.scheme, 'API_KEY');
  assert.strictEqual(deployment.scope, 'deployment');
  assert.deepStrictEqual(deployment.requiredFields, ['CONVEX_DEPLOYMENT_NAME', 'CONVEX_DEPLOY_KEY']);
  assert.strictEqual(SECRET_SOURCES.CONVEX_PERSONAL_ACCESS_TOKEN.url, 'https://dashboard.convex.dev/profile#personal-access-tokens');
  assert.ok(SECRET_SOURCES.CONVEX_DEPLOY_KEY.navigation.some(step => /Deploy keys/i.test(step)));
  assert.ok(require('../lib/providers').VALIDATORS.CONVEX_DEPLOY_KEY('dev:acoustic-panther-728|' + 'x'.repeat(40)));
});

test('SRC-15: provider source/backend metadata keeps Composio and native MCP separate from direct auth', () => {
  const { PROVIDERS } = require('../lib/providers');
  const { sourceOptions, authOptions } = require('../lib/connections');
  const row = id => PROVIDERS.find(p => p.id === id);
  assert.deepStrictEqual(sourceOptions(row('github')).map(x => x.id), ['sc', 'composio']);
  assert.deepStrictEqual(authOptions(row('github'), 'sc').map(x => x.id), ['classic-pat']);
  assert.deepStrictEqual(authOptions(row('github'), 'composio').map(x => x.scheme), ['OAUTH2']);
  assert.ok(row('supabase').sources.composio);
  assert.ok(row('stripe').sources.composio);
  assert.ok(row('cf').sources.composio);
  assert.ok(row('resend').sources.composio);
  assert.deepStrictEqual(sourceOptions(row('vercel')).map(x => x.id), ['sc', 'composio', 'native-mcp']);
  assert.strictEqual(authOptions(row('vercel'), 'native-mcp')[0].scheme, 'DCR_OAUTH');
  assert.ok(!row('github').auth.some(a => a.scheme === 'OAUTH2'), 'Composio OAuth must not be a direct auth method');
});
