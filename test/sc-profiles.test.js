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
const C = require('../lib/connections');
const { PROVIDERS } = require('../lib/providers');

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


test('PRF-16: one user can own multiple labeled provider connections and select one atomically', () => {
  P.writeProfile('multi', {});
  C.create('multi', 'github', { id: 'work', label: 'Work GitHub', authMethod: 'personal-access-token', scope: 'account', setDefault: true });
  C.create('multi', 'github', { id: 'personal', label: 'Personal GitHub', authMethod: 'personal-access-token', scope: 'account' });
  C.writeValues('multi', 'github', 'work', { GITHUB_TOKEN: 'work-private', GH_OWNER: 'work-owner' });
  C.writeValues('multi', 'github', 'personal', { GITHUB_TOKEN: 'personal-private', GH_OWNER: 'personal-owner' });
  let resolved = P.loadEnvForProfile('multi', { shellRcEnv: { GITHUB_TOKEN: 'stale-shell' } });
  assert.strictEqual(resolved.env.GH_OWNER, 'work-owner');
  assert.strictEqual(resolved.env.GITHUB_TOKEN, 'work-private');
  assert.strictEqual(resolved.selectedConnections.github.id, 'work');
  C.setDefault('multi', 'github', 'personal');
  resolved = P.loadEnvForProfile('multi', { shellRcEnv: { GITHUB_TOKEN: 'stale-shell' } });
  assert.strictEqual(resolved.env.GH_OWNER, 'personal-owner');
  assert.strictEqual(resolved.env.GITHUB_TOKEN, 'personal-private');
  assert.strictEqual(resolved.selectedConnections.github.id, 'personal');
  assert.throws(() => C.create('multi', 'github', { label: 'Personal GitHub', authMethod: 'personal-access-token' }), /label.*already exists/);
  assert.strictEqual(fs.statSync(C.connectionPath('multi', 'github', 'personal')).mode & 0o777, 0o600);
});

test('PRF-17: explicit connection override selects a non-default account without changing the default', () => {
  const resolved = P.loadEnvForProfile('multi', { connectionOverrides: { github: 'work' } });
  assert.strictEqual(resolved.env.GH_OWNER, 'work-owner');
  assert.strictEqual(resolved.selectedConnections.github.id, 'work');
  assert.strictEqual(C.selected('multi', 'github').id, 'personal', 'override must not mutate the stored default');
});

test('PRF-18: legacy Convex deploy credentials migrate into one named deployment connection without plaintext output dependency', () => {
  const key = 'prod:acoustic-panther-728|' + 'x'.repeat(48);
  P.writeProfile('convex-legacy', { CONVEX_DEPLOY_KEY: key });
  const result = C.migrateLegacy('convex-legacy', P.readProfile('convex-legacy'), PROVIDERS, {
    removeLegacy: keys => P.removeFromProfile('convex-legacy', keys),
  });
  assert.deepStrictEqual(result.migratedKeys, ['CONVEX_DEPLOY_KEY']);
  const row = C.get('convex-legacy', 'convex-cloud', 'default');
  assert.strictEqual(row.authMethod, 'deployment-key');
  assert.strictEqual(row.scope, 'deployment');
  const values = C.readValues('convex-legacy', 'convex-cloud', 'default');
  assert.strictEqual(values.CONVEX_DEPLOY_KEY, key);
  assert.strictEqual(values.CONVEX_DEPLOYMENT_NAME, 'acoustic-panther-728');
  assert.strictEqual(P.readProfile('convex-legacy').CONVEX_DEPLOY_KEY, undefined);
});

test('PRF-19: duplicate, rename, and delete user lifecycle includes named connections', () => {
  P.writeProfile('conn-source', {});
  C.create('conn-source', 'hostinger', { id: 'main', label: 'Main Hostinger', authMethod: 'api-token', setDefault: true });
  C.writeValues('conn-source', 'hostinger', 'main', { HOSTINGER_API_TOKEN: 'source-only' });
  const copied = P.duplicateProfile('conn-source', 'conn-copy');
  assert.strictEqual(copied.connections, 1);
  assert.strictEqual(C.readValues('conn-copy', 'hostinger', 'main').HOSTINGER_API_TOKEN, 'source-only');
  C.writeValues('conn-copy', 'hostinger', 'main', { HOSTINGER_API_TOKEN: 'copy-only' });
  assert.strictEqual(C.readValues('conn-source', 'hostinger', 'main').HOSTINGER_API_TOKEN, 'source-only');
  P.renameProfile('conn-copy', 'conn-renamed');
  assert.strictEqual(C.get('conn-renamed', 'hostinger', 'main').label, 'Main Hostinger');
  P.deleteProfile('conn-renamed');
  assert.deepStrictEqual(C.list('conn-renamed'), []);
});

test('PRF-20: named connection env roundtrips quotes and shell metacharacters in a 0600 file', () => {
  P.writeProfile('quoted-conn', {});
  C.create('quoted-conn', 'github', { id: 'quoted', label: 'Quoted', source: 'sc', authMethod: 'classic-pat', setDefault: true });
  const value = "ghp_quote'with $dollar and `tick`";
  C.writeValues('quoted-conn', 'github', 'quoted', { GITHUB_TOKEN: value, GH_OWNER: 'quoted-owner' });
  assert.strictEqual(C.readValues('quoted-conn', 'github', 'quoted').GITHUB_TOKEN, value);
  assert.strictEqual(fs.statSync(C.connectionPath('quoted-conn', 'github', 'quoted')).mode & 0o777, 0o600);
});

test('PRF-21: v1 connection metadata normalizes read-only and migrates explicitly to source/backend v2', () => {
  const UC = require('../lib/user-control');
  P.writeProfile('legacy-v1', {});

  const fgPath = C.connectionPath('legacy-v1', 'github', 'direct-fg');
  const classicPath = C.connectionPath('legacy-v1', 'github', 'direct-classic');
  fs.mkdirSync(path.dirname(fgPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fgPath, `GITHUB_TOKEN='github_pat_${'x'.repeat(48)}'\n`, { mode: 0o600 });
  fs.writeFileSync(classicPath, `GITHUB_TOKEN='ghp_${'y'.repeat(48)}'\n`, { mode: 0o600 });

  const rawV1 = {
    version: 1,
    users: {
      'legacy-v1': {
        providers: {
          github: {
            default: 'direct-fg',
            connections: {
              'direct-fg': { label: 'Fine', authMethod: 'personal-access-token', scope: 'account', source: 'legacy-profile' },
              'direct-classic': { label: 'Classic', authMethod: 'personal-access-token', scope: 'account' },
              oauth: { label: 'OAuth Placeholder', authMethod: 'oauth2', scope: 'account' },
            },
          },
          vercel: {
            default: 'native',
            connections: {
              native: { label: 'Native MCP', authMethod: 'mcp-oauth', scope: 'account' },
            },
          },
        },
      },
    },
  };
  fs.writeFileSync(C.CONNECTION_META, `${JSON.stringify(rawV1, null, 2)}\n`, { mode: 0o600 });

  const normalized = C.readMeta();
  assert.strictEqual(normalized.version, 2);
  assert.strictEqual(JSON.parse(fs.readFileSync(C.CONNECTION_META, 'utf8')).version, 1, 'read must not persist migration');
  assert.strictEqual(C.get('legacy-v1', 'github', 'direct-fg').source, 'sc');
  assert.strictEqual(C.get('legacy-v1', 'github', 'direct-fg').origin, 'legacy-profile');
  assert.strictEqual(C.get('legacy-v1', 'github', 'direct-fg').authMethod, 'classic-pat');
  assert.strictEqual(UC.connectionStatus('legacy-v1', 'github', 'direct-fg').credentials.find(c => c.key === 'GITHUB_TOKEN').state, 'invalid', 'old fine-grained token must require rotation to PAT classic');
  assert.strictEqual(C.get('legacy-v1', 'github', 'direct-classic').authMethod, 'classic-pat');
  assert.strictEqual(C.get('legacy-v1', 'github', 'oauth').source, 'composio');
  assert.strictEqual(UC.connectionStatus('legacy-v1', 'github', 'oauth').state, 'needs-authorization');
  assert.strictEqual(C.get('legacy-v1', 'vercel', 'native').source, 'native-mcp');
  assert.strictEqual(C.get('legacy-v1', 'vercel', 'native').authMethod, 'dcr-oauth');

  const result = C.migrateMetadata();
  assert.strictEqual(result.changed, true);
  assert.strictEqual(result.fromVersion, 1);
  assert.strictEqual(result.toVersion, 2);
  assert.ok(result.backup && fs.existsSync(result.backup));
  assert.strictEqual(fs.statSync(result.backup).mode & 0o777, 0o600);
  const persisted = fs.readFileSync(C.CONNECTION_META, 'utf8');
  assert.strictEqual(JSON.parse(persisted).version, 2);
  assert.doesNotMatch(persisted, /github_pat_|ghp_/i, 'secret values must never enter metadata');
});

test('PRF-22: named connection credential removal is exact and external connections create no local credential file', () => {
  P.writeProfile('remove-exact', {});
  C.create('remove-exact', 'github', { id: 'direct', label: 'Direct', source: 'sc', authMethod: 'classic-pat', setDefault: true });
  C.writeValues('remove-exact', 'github', 'direct', { GITHUB_TOKEN: 'ghp_' + 'z'.repeat(48), GH_OWNER: 'owner' });
  assert.deepStrictEqual(C.removeValues('remove-exact', 'github', 'direct', ['GITHUB_TOKEN']), ['GITHUB_TOKEN']);
  const remaining = C.readValues('remove-exact', 'github', 'direct');
  assert.strictEqual(remaining.GITHUB_TOKEN, undefined);
  assert.strictEqual(remaining.GH_OWNER, 'owner');

  C.create('remove-exact', 'github', {
    id: 'external', label: 'External', source: 'composio', authMethod: 'oauth2',
    external: { system: 'composio', toolkit: 'github', alias: 'external', lastKnownStatus: 'UNLINKED' },
  });
  assert.ok(!fs.existsSync(C.connectionPath('remove-exact', 'github', 'external')), 'external metadata connection must not create a local credential file');
});


test('PRF-23: selecting an external connection strips local and shell provider credentials instead of leaking them into the route', () => {
  const legacyToken = 'ghp_' + 'legacy_should_not_route';
  const shellToken = 'ghp_' + 'shell_should_not_route';
  P.writeProfile('external-isolation', { GITHUB_TOKEN: legacyToken, GH_OWNER: 'legacy-owner' });
  C.create('external-isolation', 'github', {
    id: 'work-github', label: 'Work GitHub', source: 'composio', authMethod: 'oauth2', scope: 'account', setDefault: true,
    external: { system: 'composio', toolkit: 'github', alias: 'work-github', lastKnownStatus: 'UNLINKED' },
  });
  const resolved = P.loadEnvForProfile('external-isolation', {
    shellRcEnv: { GITHUB_TOKEN: shellToken, GH_OWNER: 'shell-owner', PATH: '/usr/bin' },
    connectionOverrides: { github: 'work-github' },
  });
  assert.strictEqual(resolved.env.GITHUB_TOKEN, undefined);
  assert.strictEqual(resolved.env.GH_OWNER, undefined);
  assert.ok(resolved.shadowed.includes('GITHUB_TOKEN'));
  assert.ok(resolved.shadowed.includes('GH_OWNER'));
  assert.ok(resolved.env.PATH && resolved.env.PATH.includes('/usr/bin'), 'non-credential env must survive external routing');
  assert.strictEqual(resolved.selectedConnections.github.id, 'work-github');
  assert.strictEqual(resolved.selectedConnections.github.source, 'composio');
  assert.strictEqual(resolved.selectedConnections.github.external, true);
  assert.deepStrictEqual(resolved.selectedConnections.github.keyNames, []);
});
