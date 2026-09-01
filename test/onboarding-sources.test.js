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
  assert.match(text, /Buat di/);
  assert.match(text, /Simpan via/);
  assert.match(text, /Simpan di/);
  assert.match(text, /Lanjut/);
});
