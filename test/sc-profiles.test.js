// sc-profiles.test.js — more than one identity on one machine.
// CONFIG_DIR is captured when lib/profiles is first required, so the sandbox has to be set
// before the require below. Everything here writes inside it and nothing touches ~/.
const os = require('os');
const path = require('path');
const fs = require('fs');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-prof-'));
process.env.SC_CONFIG_DIR = SANDBOX;

const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/profiles');

test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('PRF-1: a profile name that would escape the profiles dir is rejected', () => {
  for (const bad of ['../etc/passwd', 'a/b', '', '.hidden', 'x y']) {
    assert.throws(() => P.assertName(bad), /invalid profile name/, `${JSON.stringify(bad)} accepted`);
  }
  assert.strictEqual(P.assertName('anti-nrml.2_x'), 'anti-nrml.2_x');
});

test('PRF-2: write/read roundtrip, quoting survives, file is 0600', () => {
  P.writeProfile('t1', { A: 'plain', B: "has'quote", C: 'has $DOLLAR and `tick`' });
  const back = P.readProfile('t1');
  assert.strictEqual(back.A, 'plain');
  assert.strictEqual(back.B, "has'quote");
  assert.strictEqual(back.C, 'has $DOLLAR and `tick`');
  assert.strictEqual(fs.statSync(P.profilePath('t1')).mode & 0o777, 0o600);
});

test('PRF-3: removeFromProfile drops only the named keys', () => {
  P.writeProfile('t2', { KEEP: '1', DROP: '2' });
  const removed = P.removeFromProfile('t2', ['DROP', 'NEVER_THERE']);
  assert.deepStrictEqual(removed, ['DROP']);
  assert.deepStrictEqual(P.readProfile('t2'), { KEEP: '1' });
});

test('PRF-4: sc.md roundtrips active + mappings', () => {
  const f = path.join(SANDBOX, 'roundtrip.md');
  P.writeScMd({ active: 'alpha', mappings: [
    { path: '~/projects/a', resolved: path.join(os.homedir(), 'projects/a'), profile: 'alpha' },
    { path: '/srv/b', resolved: '/srv/b', profile: 'beta' },
  ] }, f);
  const st = P.parseScMd(f);
  assert.strictEqual(st.active, 'alpha');
  assert.strictEqual(st.mappings.length, 2);
  assert.strictEqual(st.mappings[0].profile, 'alpha');
  // `~` must be expanded for matching but preserved verbatim in the file for readability.
  assert.ok(fs.readFileSync(f, 'utf8').includes('~/projects/a'));
  assert.strictEqual(st.mappings[0].resolved, path.join(os.homedir(), 'projects/a'));
});

test('PRF-5: an empty active slot is not a profile named "(none)"', () => {
  // writeScMd renders "(none)" for an empty slot. Reading that back as a real name made
  // "is anything active?" answer yes forever, so the first profile never became active.
  const f = path.join(SANDBOX, 'empty.md');
  P.writeScMd({ active: null, mappings: [] }, f);
  assert.strictEqual(P.parseScMd(f).active, null);
});

test('PRF-6: longest matching path wins, and a sibling prefix never matches', () => {
  const f = path.join(SANDBOX, 'map.md');
  P.writeScMd({ active: 'fallback', mappings: [
    { path: '/srv/app', resolved: '/srv/app', profile: 'outer' },
    { path: '/srv/app/sub/deep', resolved: '/srv/app/sub/deep', profile: 'inner' },
  ] }, f);
  assert.strictEqual(P.resolveProfile('/srv/app', f).profile, 'outer');
  assert.strictEqual(P.resolveProfile('/srv/app/sub', f).profile, 'outer');
  assert.strictEqual(P.resolveProfile('/srv/app/sub/deep', f).profile, 'inner');
  assert.strictEqual(P.resolveProfile('/srv/app/sub/deeper', f).profile, 'outer');
  // /srv/application must NOT match a rule for /srv/app — prefix matching has to be
  // path-segment aware or unrelated siblings silently inherit credentials.
  assert.strictEqual(P.resolveProfile('/srv/application', f).profile, 'fallback');
  assert.strictEqual(P.resolveProfile('/elsewhere', f).profile, 'fallback');
});

test('PRF-7: a profile ISOLATES credentials — registry keys it does not own are removed', () => {
  P.writeProfile('iso', { CLOUDFLARE_API_TOKEN: 'owned-by-iso' });
  P.writeScMd({ active: 'iso', mappings: [] });
  const { env, profile, shadowed } = P.loadEnvFor('/tmp', {
    shellRcEnv: { DOKPLOY_API_KEY: 'belongs-to-someone-else', PATH: '/usr/bin' },
  });
  assert.strictEqual(profile, 'iso');
  assert.strictEqual(env.CLOUDFLARE_API_TOKEN, 'owned-by-iso');
  assert.strictEqual(env.DOKPLOY_API_KEY, undefined, 'another identity leaked through');
  assert.ok(shadowed.includes('DOKPLOY_API_KEY'));
  assert.ok(env.PATH, 'non-credential env must survive');
});

test('PRF-8: --no-profile restores the plain shell view', () => {
  P.writeProfile('iso2', { CLOUDFLARE_API_TOKEN: 'owned' });
  P.writeScMd({ active: 'iso2', mappings: [] });
  // Use a key the real environment does not define: process.env legitimately outranks the
  // ~/.bashrc parse, so asserting on a var this machine actually exports would test the
  // machine, not the code.
  assert.strictEqual(process.env.STRIPE_SECRET_KEY, undefined, 'test precondition');
  const { env, profile } = P.loadEnvFor('/tmp', {
    noProfile: true, shellRcEnv: { STRIPE_SECRET_KEY: 'from-shell' },
  });
  assert.strictEqual(profile, null);
  assert.strictEqual(env.STRIPE_SECRET_KEY, 'from-shell', 'without a profile nothing is stripped');
});

test('PRF-9: sc.md naming a deleted profile degrades to "not found", never to a wrong one', () => {
  P.writeProfile('ghost', { CLOUDFLARE_API_TOKEN: 'x' });
  P.writeScMd({ active: 'ghost', mappings: [] });
  P.deleteProfile('ghost');
  const { profile, reason } = P.loadEnvFor('/tmp', { shellRcEnv: {} });
  assert.strictEqual(profile, null);
  assert.match(reason, /not found/);
});

test('PRF-10: legacy profiles without metadata default owner to the profile name', () => {
  P.ensureDirs();
  fs.writeFileSync(P.profilePath('legacy'), "CLOUDFLARE_API_TOKEN='legacy-token'\n", { mode: 0o600 });
  const meta = P.readProfileMeta();
  delete meta.profiles.legacy;
  P.writeProfileMeta(meta);
  assert.strictEqual(P.profileOwner('legacy'), 'legacy');
});

test('PRF-11: owner metadata is explicit, private, and returned with resolved env', () => {
  P.writeProfile('owned', { CLOUDFLARE_API_TOKEN: 'owned-token' });
  P.setProfileOwner('owned', 'Rahman personal');
  P.writeScMd({ active: 'owned', mappings: [] });
  assert.strictEqual(P.profileOwner('owned'), 'Rahman personal');
  assert.strictEqual(fs.statSync(P.PROFILE_META).mode & 0o777, 0o600);
  const metaText = fs.readFileSync(P.PROFILE_META, 'utf8');
  assert.match(metaText, /Rahman personal/);
  assert.doesNotMatch(metaText, /owned-token/, 'ownership metadata must never duplicate secret values');
  const resolved = P.loadEnvFor('/tmp', { shellRcEnv: {} });
  assert.strictEqual(resolved.profile, 'owned');
  assert.strictEqual(resolved.owner, 'Rahman personal');
});

test('PRF-12: deleting a profile removes its ownership metadata too', () => {
  P.writeProfile('delete-me', { CLOUDFLARE_API_TOKEN: 'x' });
  P.setProfileOwner('delete-me', 'Temporary user');
  assert.strictEqual(P.profileOwner('delete-me'), 'Temporary user');
  P.deleteProfile('delete-me');
  assert.strictEqual(P.readProfileMeta().profiles['delete-me'], undefined);
});

test('PRF-13: duplicateProfile creates an independent credential store and can fill an existing empty user only explicitly', () => {
  P.writeProfile('dup-source', { GITHUB_TOKEN: 'gh-source', HOSTINGER_API_TOKEN: 'host-source' });
  P.setProfileOwner('dup-source', 'dup-source');
  P.writeProfile('dup-target', {});
  assert.throws(() => P.duplicateProfile('dup-source', 'dup-target'), /replaceEmpty/);
  const copied = P.duplicateProfile('dup-source', 'dup-target', { owner: 'dup-target', replaceEmpty: true });
  assert.deepStrictEqual(copied.keys.sort(), ['GITHUB_TOKEN', 'HOSTINGER_API_TOKEN']);
  assert.strictEqual(P.profileOwner('dup-target'), 'dup-target');
  P.writeProfile('dup-target', { GITHUB_TOKEN: 'gh-target' });
  assert.strictEqual(P.readProfile('dup-source').GITHUB_TOKEN, 'gh-source', 'rotating target must not change source');
  assert.strictEqual(P.readProfile('dup-target').GITHUB_TOKEN, 'gh-target');
});

test('PRF-14: renameProfile migrates default and folder mappings without changing credential values', () => {
  P.writeProfile('rename-old', { GITHUB_TOKEN: 'keep-me' });
  P.setProfileOwner('rename-old', 'rename-old');
  P.writeScMd({ active: 'rename-old', mappings: [
    { path: '/srv/rename', resolved: '/srv/rename', profile: 'rename-old' },
  ] });
  P.renameProfile('rename-old', 'rename-new');
  assert.strictEqual(P.profileExists('rename-old'), false);
  assert.strictEqual(P.readProfile('rename-new').GITHUB_TOKEN, 'keep-me');
  assert.strictEqual(P.profileOwner('rename-new'), 'rename-new');
  const state = P.parseScMd();
  assert.strictEqual(state.active, 'rename-new');
  assert.strictEqual(state.mappings[0].profile, 'rename-new');
});

test('PRF-15: importProfileFromEnv imports only registry credentials and does not overwrite by default', () => {
  P.writeProfile('import-user', { GITHUB_TOKEN: 'existing' });
  const first = P.importProfileFromEnv('import-user', {
    GITHUB_TOKEN: 'shell-github',
    HOSTINGER_API_TOKEN: 'shell-hostinger',
    NOT_A_PROVIDER_SECRET: 'ignore-me',
  });
  assert.deepStrictEqual(first.keys, ['HOSTINGER_API_TOKEN']);
  assert.strictEqual(P.readProfile('import-user').GITHUB_TOKEN, 'existing');
  assert.strictEqual(P.readProfile('import-user').HOSTINGER_API_TOKEN, 'shell-hostinger');
  assert.strictEqual(P.readProfile('import-user').NOT_A_PROVIDER_SECRET, undefined);
  P.importProfileFromEnv('import-user', { GITHUB_TOKEN: 'replacement' }, { overwrite: true });
  assert.strictEqual(P.readProfile('import-user').GITHUB_TOKEN, 'replacement');
});
