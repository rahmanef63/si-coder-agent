#!/usr/bin/env node
// sc.js — si-coder provider console.
//
//   sc setup        [--providers a,b | --target t]   interactive wizard for what is missing
//   sc providers    [show|set|rm <id>]               inspect / rotate / remove one provider
//   sc doctor       [--providers a,b | --target t]   LIVE verification against each real API
//   sc preflight    --target <t>                     what /sc-all runs before deploying
//
// The split that matters: `providers` reports what is CONFIGURED (presence + format),
// `doctor` reports what actually WORKS (a real call to the real API). A token can be
// perfectly well-formed and still be revoked, expired, or belong to the wrong account —
// only the second question catches that, and it is the one that used to go unasked.
const fs = require('fs');
const path = require('path');
const {
  PROVIDERS, BUILTIN_PROVIDERS, BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_KEYS, TARGET_PROVIDERS, VALIDATORS, DOMAIN_VARS,
} = require(path.resolve(__dirname, '../lib/providers'));
const { isSecret, sourceLine, readShellRcEnv } =
  require(path.resolve(__dirname, '../skills/sc-onboarding/lib/onboarding-domains'));
const { appendExportToShellRc, removeExportsFromShellRc } =
  require(path.resolve(__dirname, '../lib/env'));
const { spawnSync } = require('child_process');
const { askVisible, askHidden, redactValue, isInteractive, confirm, selectOne, selectMany } =
  require(path.resolve(__dirname, '../lib/prompt'));
const P = require(path.resolve(__dirname, '../lib/profiles'));
const CP = require(path.resolve(__dirname, '../lib/custom-providers'));
const { audit, readAudit } = require(path.resolve(__dirname, '../lib/audit'));
const { checkUpdate, performUpdate } = require(path.resolve(__dirname, '../lib/update'));
const PKG = require(path.resolve(__dirname, '../package.json'));

const CUSTOM_OPTIONS = { builtInIds: BUILTIN_PROVIDER_IDS, builtInKeys: BUILTIN_PROVIDER_KEYS };
const BUILTIN_IDS = new Set(BUILTIN_PROVIDER_IDS);

const byId = new Map(PROVIDERS.map(p => [p.id, p]));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (n && !n.startsWith('--')) { out[k] = n; i++; } else out[k] = true;
    } else out._.push(a);
  }
  return out;
}

// Resolution order: profile (if one governs this directory) > process.env > ~/.bashrc.
// The profile deliberately outranks the shell — see the precedence note in lib/profiles.js.
let NO_PROFILE = false;
let _envCache = null;
function currentEnvFull() {
  if (!_envCache) _envCache = P.loadEnvFor(process.cwd(), { noProfile: NO_PROFILE, shellRcEnv: readShellRcEnv() });
  return _envCache;
}
function currentEnv() { return currentEnvFull().env; }

// One line, printed once, so it is never a mystery which identity a command ran as.
function profileBanner() {
  const { profile, reason } = currentEnvFull();
  const { shadowed } = currentEnvFull();
  if (profile) {
    console.log(`  👤 profile: ${profile}  (${reason})`);
    if (shadowed.length) console.log(`     ignoring ${shadowed.length} var(s) from the shell not owned by this profile: ${shadowed.join(', ')}`);
  }
  else if (P.listProfiles().length) console.log(`  👤 profile: none  (${reason}) — \`sc user which\` explains`);
}

function sourceOf(key) {
  const { profile } = currentEnvFull();
  if (profile) {
    if (P.readProfile(profile)[key]) return `profile:${profile}`;
    if (process.env[key] || readShellRcEnv()[key]) return 'shadowed-by-profile';
    return '—';
  }
  if (process.env[key]) return 'shell';
  if (readShellRcEnv()[key]) return '.bashrc';
  return '—';
}

function resolveIds(args) {
  if (args.target) {
    const ids = TARGET_PROVIDERS[args.target];
    if (!ids) die(`unknown --target "${args.target}" (expected: ${Object.keys(TARGET_PROVIDERS).join(' | ')})`);
    return ids;
  }
  if (typeof args.providers === 'string') {
    const ids = args.providers.split(',').map(s => s.trim()).filter(Boolean);
    const bad = ids.filter(i => !byId.has(i));
    if (bad.length) die(`unknown provider(s): ${bad.join(', ')}`);
    return ids;
  }
  return null;
}

function die(msg, code = 1) { console.error(`❌ ${msg}`); process.exit(code); }

// ---------------------------------------------------------------------------
// providers — what is configured
// ---------------------------------------------------------------------------
function varState(v, env) {
  if (!env[v.key]) return v.required ? 'MISSING' : 'unset';
  const validator = VALIDATORS[v.key];
  if (validator && !validator(env[v.key])) return 'INVALID';
  return 'set';
}

function safeProviderRow(p, env) {
  return {
    id: p.id,
    title: p.title,
    blurb: p.blurb,
    status: p.status,
    builtIn: BUILTIN_IDS.has(p.id),
    vars: p.vars.map(v => ({
      key: v.key,
      required: Boolean(v.required),
      secret: isSecret(v.key),
      state: varState(v, env),
      source: sourceOf(v.key),
      url: v.url || undefined,
      note: v.note || undefined,
    })),
  };
}

function cmdProvidersList(args) {
  const env = currentEnv();
  const ids = resolveIds(args) || PROVIDERS.map(p => p.id);
  if (args.json) {
    console.log(JSON.stringify({ providers: ids.map(id => safeProviderRow(byId.get(id), env)) }, null, 2));
    return;
  }
  console.log('\n🔌 providers\n');
  profileBanner();
  for (const id of ids) {
    const p = byId.get(id);
    const states = p.vars.map(v => varState(v, env));
    const missing = p.vars.filter((v, i) => states[i] === 'MISSING').map(v => v.key);
    const invalid = p.vars.filter((v, i) => states[i] === 'INVALID').map(v => v.key);
    const setCount = states.filter(s => s === 'set').length;
    let mark = '✅';
    if (invalid.length) mark = '❗';
    else if (missing.length) mark = '❌';
    else if (setCount === 0) mark = '⚪';
    const tag = p.status === 'stub' ? ' (stub)' : '';
    console.log(`  ${mark} ${p.id.padEnd(14)} ${String(setCount).padStart(2)}/${p.vars.length} set${tag}  — ${p.blurb}`);
    if (missing.length) console.log(`       missing required: ${missing.join(', ')}`);
    if (invalid.length) console.log(`       failed validation: ${invalid.join(', ')}`);
  }
  console.log('\n  ✅ complete   ❌ missing required   ❗ present but malformed   ⚪ nothing set\n');
  console.log('  sc providers show <id>   sc providers set <id>   sc doctor\n');
}

async function cmdProvidersShow(id) {
  if (!id) id = await pickProvider('Show which provider?');
  const p = byId.get(id) || die(`unknown provider "${id}"`);
  const env = currentEnv();
  console.log(`\n🔌 ${p.id} — ${p.title}${p.status === 'stub' ? '  (STUB: script not implemented)' : ''}`);
  console.log(`   ${p.blurb}\n`);
  for (const v of p.vars) {
    const st = varState(v, env);
    const icon = { set: '✅', MISSING: '❌', INVALID: '❗', unset: '⚪' }[st];
    console.log(`  ${icon} ${v.key}${v.required ? ' (required)' : ''}`);
    if (env[v.key]) console.log(`       value : ${isSecret(v.key) ? `[hidden len=${String(env[v.key]).length}]` : env[v.key]}   [from ${sourceOf(v.key)}]`);
    const src = sourceLine(v.key);
    if (src) console.log(`       ↳ ${src}`);
  }
  console.log('');
}


// A provider list shaped for the arrow-key pickers, annotated with live state so the user
// can see what needs attention without leaving the menu.
function providerItems() {
  const env = currentEnv();
  return PROVIDERS.map(p => {
    const states = p.vars.map(v => varState(v, env));
    const missing = states.filter(s => s === 'MISSING').length;
    const invalid = states.filter(s => s === 'INVALID').length;
    const set = states.filter(s => s === 'set').length;
    let mark = '✅';
    if (invalid) mark = '❗';
    else if (missing) mark = '❌';
    else if (!set) mark = '⚪';
    return {
      id: p.id,
      label: `${mark} ${p.id.padEnd(14)} ${String(set).padStart(2)}/${p.vars.length}`,
      hint: `${p.status === 'stub' ? '(stub) ' : ''}${p.blurb}`,
      needsAttention: missing > 0 || invalid > 0,
      stub: p.status === 'stub',
      hasAny: set > 0,
    };
  });
}

// Lenses over the same provider list. "needs attention" first is deliberate: it is the
// reason you opened this menu almost every time.
const PROVIDER_TABS = [
  { id: 'all',       label: 'All',      filter: null },
  { id: 'attention', label: 'Needs fix', filter: it => it.needsAttention },
  { id: 'ready',     label: 'Ready',    filter: it => !it.needsAttention && !it.stub && it.hasAny },
  { id: 'stub',      label: 'Stubs',    filter: it => it.stub },
];

// Pick one provider by arrow keys when the id was not given on the command line.
async function pickProvider(title) {
  if (!isInteractive()) die('provider id required on a non-TTY, e.g. `sc providers show cf`');
  const id = await selectOne(title, providerItems(), PROVIDER_TABS);
  if (!id) { console.log('cancelled'); process.exit(0); }
  return id;
}

// ---------------------------------------------------------------------------
// setup / set — collect values
// ---------------------------------------------------------------------------
async function promptForVar(v, { force = false } = {}) {
  const src = sourceLine(v.key);
  console.log('');
  console.log(`  ${v.key}${v.required ? '' : '  (optional — press Enter to skip)'}`);
  if (src) console.log(`    ↳ ${src}`);
  if (isSecret(v.key)) console.log('    ↳ input is hidden (not echoed)');
  while (true) {
    const value = isSecret(v.key) ? await askHidden('    value: ') : await askVisible('    value: ');
    if (!value && !v.required) return null;
    if (!value && v.required) { console.log(`    ❌ ${v.key} is required`); continue; }
    const validator = VALIDATORS[v.key];
    if (validator && !validator(value)) { console.log(`    ❌ ${v.key} failed validation, try again`); continue; }
    console.log(isSecret(v.key) ? `    ✅ got ${v.key} (hidden, len=${value.length})` : `    ✅ got ${v.key} (${redactValue(value)})`);
    return value;
  }
}

async function collect(ids, { force = false } = {}) {
  const env = currentEnv();
  const updates = {};
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) { console.log(`⚠️ unknown provider "${id}", skip`); continue; }
    const todo = p.vars.filter(v => force || !env[v.key] || varState(v, env) === 'INVALID');
    if (todo.length === 0) { console.log(`  ✅ ${p.id}: already complete`); continue; }
    console.log(`\n── ${p.id.toUpperCase()} — ${p.title} ──`);
    console.log(`   ${p.blurb}`);
    if (p.status === 'stub') console.log('   ⚠️ this /sc-* script is not implemented yet; values are stored for later.');
    for (const v of todo) {
      const val = await promptForVar(v, { force });
      if (val !== null) updates[v.key] = val;
    }
  }
  return updates;
}


// Where a newly entered credential is stored.
// Backwards compatible on purpose: a machine with no profiles keeps using the ~/.bashrc
// managed block exactly as before. The moment a profile exists, writes go there instead —
// otherwise a second identity would silently land in the first one's shell.
function writeTarget() {
  const { profile } = currentEnvFull();
  if (profile) return { kind: 'profile', name: profile };
  if (P.listProfiles().length) return { kind: 'profile-unset', name: null };
  return { kind: 'bashrc', name: null };
}

function persist(updates) {
  const t = writeTarget();
  if (t.kind === 'profile') {
    P.writeProfile(t.name, updates);
    console.log(`\n✅ Wrote ${Object.keys(updates).length} value(s) to profile "${t.name}" (${P.profilePath(t.name)})`);
    console.log('   Use `sc run -- <cmd>` to consume them without revealing plaintext.');
    return t;
  }
  if (t.kind === 'profile-unset') {
    die('profiles exist but none governs this directory — pick one with `sc user use <name>` or map it with `sc user map . <name>`');
  }
  appendExportToShellRc(updates);
  console.log(`\n✅ Wrote ${Object.keys(updates).length} export(s) to ~/.bashrc`);
  console.log('   Next: source ~/.bashrc');
  return t;
}

async function cmdSetup(args) {
  if (!isInteractive()) die('sc setup needs a TTY. Non-interactive? Use:\n   printf \'KEY=VALUE\\n\' | node skills/sc-onboarding/scripts/scan-env.js --write-stdin');
  console.log('\n🚀 si-coder setup\n');
  let ids = resolveIds(args);
  if (!ids) {
    const items = providerItems();
    // Do not pre-check unrelated providers. A highlighted row must never look like the
    // provider the user is about to configure while hidden defaults point somewhere else.
    // With no boxes checked, Enter selects the highlighted provider; Space remains the
    // explicit multi-select control.
    ids = await selectMany('Which providers do you want to set up?', items, [], PROVIDER_TABS);
    if (ids === null) { console.log('cancelled'); return; }
    if (ids.length === 0) { console.log('Nothing selected.'); return; }
  }
  const updates = await collect(ids, { force: Boolean(args.force) });
  if (Object.keys(updates).length === 0) { console.log('\n✅ Nothing to write — everything asked for is already set.'); return; }
  persist(updates);
  console.log('  Then: sc doctor');
}

async function cmdProvidersSet(id) {
  if (!isInteractive()) die('sc providers set needs a TTY.');
  if (!id) id = await pickProvider('Re-enter credentials for which provider?');
  byId.get(id) || die(`unknown provider "${id}"`);
  console.log(`\n🔁 re-entering every var for "${id}" (existing values will be replaced)\n`);
  const updates = await collect([id], { force: true });
  if (Object.keys(updates).length === 0) { console.log('\nNothing entered — no change.'); return; }
  persist(updates);
}

async function cmdProvidersRm(id, args) {
  if (!id) id = await pickProvider('Remove credentials for which provider?');
  const p = byId.get(id) || die(`unknown provider "${id}"`);
  const keys = p.vars.map(v => v.key);
  console.log(`\nThis removes from the si-coder block in ~/.bashrc:\n  ${keys.join('\n  ')}\n`);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to remove without --yes on a non-TTY.');
    if (!await confirm('Remove them?')) { console.log('aborted'); return; }
  }
  const t = writeTarget();
  if (t.kind === 'profile') {
    const removed = P.removeFromProfile(t.name, keys);
    console.log(removed.length ? `✅ removed from profile "${t.name}": ${removed.join(', ')}` : `nothing to remove in profile "${t.name}"`);
    return;
  }
  const { removed, unmanaged } = removeExportsFromShellRc(keys);
  console.log(removed.length ? `✅ removed: ${removed.join(', ')}` : 'nothing to remove in the managed block');
  if (unmanaged.length) {
    console.log(`⚠️ still exported OUTSIDE the si-coder block (left untouched, edit ~/.bashrc by hand): ${unmanaged.join(', ')}`);
  }
  console.log('Run: source ~/.bashrc   (a removed var stays in THIS shell until you start a new one)');
}


// ---------------------------------------------------------------------------
// provider-definition CRUD + secret-safe credential CRUD
// ---------------------------------------------------------------------------
function customVarFromArgs(key, args) {
  return {
    key,
    required: Boolean(args.required),
    secret: !Boolean(args.public),
    url: typeof args.url === 'string' ? args.url : undefined,
    note: typeof args.note === 'string' ? args.note : undefined,
    prefix: typeof args.prefix === 'string' ? args.prefix : undefined,
    minLength: typeof args['min-length'] === 'string' ? Number(args['min-length']) : undefined,
  };
}

function assertCustom(id) {
  if (BUILTIN_IDS.has(id)) die(`provider "${id}" is built-in and its definition is immutable; CRUD only applies to custom providers`);
  const p = byId.get(id);
  if (!p) die(`unknown custom provider "${id}"`);
  return p;
}

function purgeKeysEverywhere(keys) {
  const profiles = [];
  for (const name of P.listProfiles()) {
    const removed = P.removeFromProfile(name, keys);
    if (removed.length) profiles.push({ profile: name, keys: removed });
  }
  const shell = removeExportsFromShellRc(keys);
  return { profiles, shell };
}

function cmdProviderCreate(id, args) {
  if (!id) die('usage: sc providers create <id> --key ENV_KEY [--title ...] [--blurb ...]');
  if (!args.key || typeof args.key !== 'string') die('sc providers create requires --key ENV_KEY');
  const p = CP.createProvider({
    id,
    title: typeof args.title === 'string' ? args.title : id,
    blurb: typeof args.blurb === 'string' ? args.blurb : 'custom credential provider',
    vars: [customVarFromArgs(args.key, args)],
  }, CUSTOM_OPTIONS);
  audit('provider.create', { provider: p.id, keyName: args.key });
  console.log(`✅ created custom provider ${p.id} with ${args.key}`);
  console.log('   credential value was not requested; use `sc secret set` from a terminal.');
}

function cmdProviderUpdate(id, args) {
  assertCustom(id);
  const patch = {};
  if (typeof args.title === 'string') patch.title = args.title;
  if (typeof args.blurb === 'string') patch.blurb = args.blurb;
  if (!Object.keys(patch).length) die('nothing to update — use --title and/or --blurb');
  const p = CP.updateProvider(id, patch, CUSTOM_OPTIONS);
  audit('provider.update', { provider: p.id, fields: Object.keys(patch) });
  console.log(`✅ updated custom provider ${p.id}: ${Object.keys(patch).join(', ')}`);
}

async function cmdProviderDelete(id, args) {
  const p = assertCustom(id);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to delete a provider without --yes on a non-TTY');
    if (!await confirm(`Delete custom provider "${id}" AND purge its managed credentials from all si-coder profiles?`)) return console.log('aborted');
  }
  const removed = CP.deleteProvider(id, CUSTOM_OPTIONS);
  const purge = purgeKeysEverywhere(removed.vars.map(v => v.key));
  audit('provider.delete', { provider: id, keyNames: removed.vars.map(v => v.key), profilesTouched: purge.profiles.map(x => x.profile) });
  console.log(`✅ deleted custom provider ${id} and purged managed credential keys`);
  if (purge.shell.unmanaged.length) console.log(`⚠️ user-owned exports outside the si-coder block were left untouched: ${purge.shell.unmanaged.join(', ')}`);
  console.log('   Existing values already exported in THIS shell remain until that shell exits.');
}

function cmdProviderKeyAdd(id, key, args) {
  assertCustom(id);
  if (!key) die('usage: sc providers key-add <id> <ENV_KEY> [--required] [--public]');
  const v = CP.addProviderVar(id, customVarFromArgs(key, args), CUSTOM_OPTIONS);
  audit('provider.key-add', { provider: id, keyName: v.key });
  console.log(`✅ added ${v.key} to custom provider ${id}`);
}

async function cmdProviderKeyRm(id, key, args) {
  assertCustom(id);
  if (!key) die('usage: sc providers key-rm <id> <ENV_KEY> [--yes]');
  if (!args.yes) {
    if (!isInteractive()) die('refusing to remove a provider key without --yes on a non-TTY');
    if (!await confirm(`Remove ${key} from ${id} AND purge its managed credential value everywhere?`)) return console.log('aborted');
  }
  const v = CP.removeProviderVar(id, key, CUSTOM_OPTIONS);
  const purge = purgeKeysEverywhere([v.key]);
  audit('provider.key-remove', { provider: id, keyName: v.key, profilesTouched: purge.profiles.map(x => x.profile) });
  console.log(`✅ removed ${v.key} from ${id} and purged its managed credential value`);
  if (purge.shell.unmanaged.length) console.log(`⚠️ user-owned export outside the si-coder block was left untouched: ${purge.shell.unmanaged.join(', ')}`);
}

function secretRows(providerId) {
  const env = currentEnv();
  const providers = providerId ? [byId.get(providerId) || die(`unknown provider "${providerId}"`)] : PROVIDERS;
  return providers.map(p => ({
    provider: p.id,
    keys: p.vars.map(v => ({
      key: v.key,
      secret: isSecret(v.key),
      required: Boolean(v.required),
      state: varState(v, env),
      source: sourceOf(v.key),
    })),
  }));
}

function cmdSecretList(providerId, args) {
  const rows = secretRows(providerId);
  if (args.json) return console.log(JSON.stringify({ credentials: rows }, null, 2));
  console.log('\n🔐 credential status — values are never printed\n');
  for (const row of rows) {
    console.log(`  ${row.provider}`);
    for (const k of row.keys) console.log(`    ${k.state === 'set' ? '✅' : k.state === 'INVALID' ? '❗' : k.state === 'MISSING' ? '❌' : '⚪'} ${k.key.padEnd(34)} ${k.state.padEnd(7)} from ${k.source}`);
  }
  console.log('\n  Use `sc run -- <cmd>` to consume credentials without revealing them.\n');
}

function cmdSecretShow(providerId, key, args) {
  if (!providerId) die('usage: sc secret get <provider> [ENV_KEY]');
  const p = byId.get(providerId) || die(`unknown provider "${providerId}"`);
  const vars = key ? [p.vars.find(v => v.key === key) || die(`${providerId} does not define ${key}`)] : p.vars;
  const env = currentEnv();
  const out = vars.map(v => ({
    provider: providerId,
    key: v.key,
    secret: isSecret(v.key),
    required: Boolean(v.required),
    state: varState(v, env),
    source: sourceOf(v.key),
    readable: false,
  }));
  if (args.json) return console.log(JSON.stringify({ credentials: out }, null, 2));
  for (const row of out) console.log(`${row.provider}.${row.key}: ${row.state} from ${row.source} (plaintext read disabled)`);
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; if (data.length > 1024 * 1024) reject(new Error('stdin secret exceeds 1 MiB')); });
    process.stdin.on('end', () => resolve(data.replace(/[\r\n]+$/, '')));
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

async function readSecretInput(v, args) {
  const sources = ['stdin', 'from-env', 'from-file'].filter(k => args[k] !== undefined && args[k] !== false);
  if (sources.length > 1) die('choose exactly one secret input source: --stdin | --from-env NAME | --from-file PATH');
  if (args.value !== undefined) die('refusing --value: secret values must never be passed in argv; use hidden TTY, --stdin, --from-env, or --from-file');

  let value;
  let source = 'tty';
  if (args.stdin) {
    if (process.stdin.isTTY) die('--stdin expects a pipe/FD; omit it to use the hidden terminal prompt');
    value = await readAllStdin();
    source = 'stdin';
  } else if (typeof args['from-env'] === 'string') {
    const name = args['from-env'];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) die('invalid --from-env variable name');
    value = process.env[name];
    if (!value) die(`environment variable ${name} is not set`);
    source = `env:${name}`;
  } else if (typeof args['from-file'] === 'string') {
    value = fs.readFileSync(path.resolve(args['from-file']), 'utf8').replace(/[\r\n]+$/, '');
    source = 'file';
  } else {
    if (!isInteractive()) die('no secret input source on a non-TTY; use --stdin, --from-env NAME, or --from-file PATH');
    value = isSecret(v.key) ? await askHidden(`  ${v.key} (hidden): `) : await askVisible(`  ${v.key}: `);
  }
  if (!value) die(`${v.key} cannot be empty`);
  const validator = VALIDATORS[v.key];
  if (validator && !validator(value)) die(`${v.key} failed validation`);
  return { value, source };
}

async function cmdSecretSet(providerId, key, args) {
  if (!providerId) die('usage: sc secret set <provider> [ENV_KEY] [--stdin|--from-env NAME|--from-file PATH]');
  const p = byId.get(providerId) || die(`unknown provider "${providerId}"`);
  if (!key) {
    if (args.stdin || args['from-env'] || args['from-file']) die('a non-interactive input source requires one ENV_KEY');
    return cmdProvidersSet(providerId);
  }
  const v = p.vars.find(x => x.key === key) || die(`${providerId} does not define ${key}`);
  const { value, source } = await readSecretInput(v, args);
  const target = persist({ [key]: value });
  audit('credential.set', { provider: providerId, keyName: key, inputSource: source, store: target.kind, profile: target.name || undefined });
  console.log(`✅ stored ${providerId}.${key}; value not displayed`);
}

async function cmdSecretRm(providerId, key, args) {
  if (!providerId) die('usage: sc secret rm <provider> [ENV_KEY] [--yes]');
  const p = byId.get(providerId) || die(`unknown provider "${providerId}"`);
  const keys = key ? [p.vars.find(v => v.key === key)?.key || die(`${providerId} does not define ${key}`)] : p.vars.map(v => v.key);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to remove credentials without --yes on a non-TTY');
    if (!await confirm(`Remove ${keys.join(', ')} from the current si-coder credential store?`)) return console.log('aborted');
  }
  const t = writeTarget();
  let removed = [], unmanaged = [];
  if (t.kind === 'profile') removed = P.removeFromProfile(t.name, keys);
  else if (t.kind === 'profile-unset') die('profiles exist but none governs this directory — use `sc user which`');
  else ({ removed, unmanaged } = removeExportsFromShellRc(keys));
  audit('credential.remove', { provider: providerId, keyNames: keys, store: t.kind, profile: t.name || undefined });
  console.log(removed.length ? `✅ removed ${removed.join(', ')}` : 'nothing to remove');
  if (unmanaged.length) console.log(`⚠️ left user-owned exports outside the si-coder block untouched: ${unmanaged.join(', ')}`);
}

function cmdAudit(args) {
  const rows = readAudit({ limit: args.limit });
  if (args.json) return console.log(JSON.stringify({ audit: rows }, null, 2));
  console.log('\n🧾 si-coder audit (metadata only; no secret values)\n');
  for (const row of rows) {
    const rest = Object.entries(row).filter(([k]) => !['ts', 'action'].includes(k)).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ');
    console.log(`  ${row.ts || '—'}  ${row.action}${rest ? `  ${rest}` : ''}`);
  }
  if (!rows.length) console.log('  (empty)');
  console.log('');
}

function cmdVersion(args = {}) {
  const st = checkUpdate({ fetch: false });
  const out = { version: PKG.version, source: path.resolve(__dirname, '..'), git: st.gitCheckout ? { branch: st.branch, head: st.head, dirty: st.dirty } : null };
  if (args.json) return console.log(JSON.stringify(out, null, 2));
  console.log(`sc ${out.version}${out.git?.head ? ` (${out.git.head.slice(0, 8)} ${out.git.branch}${out.git.dirty ? ', dirty' : ''})` : ''}`);
  console.log(`source: ${out.source}`);
}

function cmdUpdate(args) {
  const status = args.check ? checkUpdate() : performUpdate();
  const out = {
    state: status.state || status.reason || 'unknown',
    branch: status.branch || null,
    head: status.head || null,
    remoteHead: status.remoteHead || null,
    ahead: status.ahead || 0,
    behind: status.behind || 0,
    dirty: Boolean(status.dirty),
    changed: Boolean(status.changed),
  };
  if (!args.check) audit('sc.update', { state: out.state, changed: out.changed, branch: out.branch });
  if (args.json) return console.log(JSON.stringify(out, null, 2));
  if (args.check) {
    console.log(`sc update: ${out.state}${out.behind ? ` — ${out.behind} commit(s) available` : ''}${out.ahead ? ` — ${out.ahead} local commit(s)` : ''}${out.dirty ? ' — dirty checkout' : ''}`);
  } else if (out.changed) {
    console.log(`✅ sc updated by fast-forward to ${status.newHead.slice(0, 8)}`);
    console.log('   linked CLI/skills use this checkout, so the next `sc` invocation uses the update.');
  } else console.log('✅ sc is already up to date');
}



// ---------------------------------------------------------------------------
// user / profile commands
// ---------------------------------------------------------------------------
function ensureScMd() {
  const st = P.parseScMd();
  if (!st.exists) P.writeScMd({ active: null, mappings: [] });
  return P.parseScMd();
}

function cmdUserList() {
  const names = P.listProfiles();
  const st = ensureScMd();
  const { profile, reason } = P.resolveProfile();
  console.log('\n👥 profiles\n');
  if (!names.length) {
    console.log('  (none yet)\n\n  sc user add <name>              create one');
    console.log('  sc user add <name> --from-shell import what is exported right now\n');
    return;
  }
  for (const n of names) {
    const keys = Object.keys(P.readProfile(n)).length;
    const marks = [];
    if (n === st.active) marks.push('active');
    if (n === profile) marks.push('current dir');
    console.log(`  ${n === profile ? '❯' : ' '} ${n.padEnd(18)} ${String(keys).padStart(2)} value(s)${marks.length ? '   [' + marks.join(', ') + ']' : ''}`);
  }
  console.log(`\n  here: ${profile || 'none'}  (${reason})`);
  console.log(`  map:  ${P.SC_MD}\n`);
}

function cmdUserWhich() {
  const { profile, reason, mapping, state } = P.resolveProfile();
  console.log(`\n📍 cwd      : ${process.cwd()}`);
  console.log(`   profile  : ${profile || '(none)'}`);
  console.log(`   because  : ${reason}`);
  if (mapping) console.log(`   rule     : ${mapping.path} → ${mapping.profile}`);
  if (profile && !P.profileExists(profile)) {
    console.log(`   ⚠️ sc.md names "${profile}" but ~/.config/si-coder/profiles/${profile}.env does not exist`);
  }
  if (state.mappings.length) {
    console.log('\n   all rules (longest match wins):');
    for (const m of state.mappings) {
      const dead = P.profileExists(m.profile) ? '' : '   ⚠️ profile missing';
      console.log(`     ${m.path.padEnd(38)} → ${m.profile}${dead}`);
    }
  }
  console.log(`\n   sc.md    : ${P.SC_MD}\n`);
}

async function cmdUserAdd(name, args) {
  if (!name) {
    if (!isInteractive()) die('usage: sc user add <name> [--from-shell]');
    name = await askVisible('New profile name: ');
  }
  P.assertName(name);
  if (P.profileExists(name) && !args.force) die(`profile "${name}" already exists (use --force to overwrite)`);
  let updates = {};
  if (args['from-shell']) {
    // Migration path off the single-identity ~/.bashrc: snapshot every registry var that is
    // currently visible, so the first profile is a copy of what already worked.
    const env = { ...readShellRcEnv(), ...process.env };
    for (const v of PROVIDERS.flatMap(p => p.vars)) if (env[v.key]) updates[v.key] = env[v.key];
    console.log(`  imported ${Object.keys(updates).length} value(s) from the current environment`);
  }
  P.writeProfile(name, updates);
  const st = ensureScMd();
  if (!st.active) P.writeScMd({ active: name, mappings: st.mappings });
  console.log(`✅ profile "${name}" created at ${P.profilePath(name)}`);
  if (!st.active) console.log(`   set as the active profile`);
  console.log(`\n   next: sc user map <folder> ${name}    (or: sc user use ${name})`);
}

function cmdUserUse(name) {
  if (!name) die('usage: sc user use <name>');
  if (!P.profileExists(name)) die(`no such profile "${name}" — sc user list`);
  const st = ensureScMd();
  P.writeScMd({ active: name, mappings: st.mappings });
  console.log(`✅ active profile: ${name}`);
}

function cmdUserMap(dir, name) {
  if (!dir || !name) die('usage: sc user map <folder> <profile>');
  if (!P.profileExists(name)) die(`no such profile "${name}" — sc user list`);
  const st = ensureScMd();
  // Store what the user typed (so `~` stays readable in sc.md) but de-dupe on the resolved
  // path, or `.` and `~/x` could quietly create two rules for one directory.
  const shown = dir === '.' ? process.cwd() : dir;
  const resolved = path.resolve(P.expandHome(shown));
  const mappings = st.mappings.filter(m => m.resolved !== resolved);
  mappings.push({ path: shown, resolved, profile: name });
  mappings.sort((a, b) => a.resolved.localeCompare(b.resolved));
  P.writeScMd({ active: st.active, mappings });
  console.log(`✅ ${shown} → ${name}`);
}

function cmdUserUnmap(dir) {
  if (!dir) die('usage: sc user unmap <folder>');
  const st = ensureScMd();
  const resolved = path.resolve(P.expandHome(dir === '.' ? process.cwd() : dir));
  const kept = st.mappings.filter(m => m.resolved !== resolved);
  if (kept.length === st.mappings.length) die(`no rule for ${dir}`);
  P.writeScMd({ active: st.active, mappings: kept });
  console.log(`✅ removed the rule for ${dir}`);
}

async function cmdUserRm(name, args) {
  if (!name) die('usage: sc user rm <name> [--yes]');
  if (!P.profileExists(name)) die(`no such profile "${name}"`);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to delete a profile without --yes on a non-TTY');
    if (!await confirm(`Delete profile "${name}" and its stored credentials?`)) { console.log('aborted'); return; }
  }
  P.deleteProfile(name);
  const st = ensureScMd();
  P.writeScMd({
    active: st.active === name ? null : st.active,
    mappings: st.mappings.filter(m => m.profile !== name),
  });
  console.log(`✅ deleted profile "${name}" and any sc.md rules pointing at it`);
}

// `sc env` used to print plaintext export lines for command substitution. That makes a
// credential-readable API surface and is incompatible with agent-safe storage. Keep the
// command name only as a fail-closed migration message; `sc run` is the non-exfiltrating path.
function cmdEnv() {
  die('plaintext credential export is disabled — use `sc run -- <command>` so the child receives the resolved profile without printing it');
}


// Run any command with the resolved profile injected. Keeps secrets out of the parent shell.
function cmdRun(args) {
  const idx = process.argv.indexOf('--');
  const cmd = idx === -1 ? [] : process.argv.slice(idx + 1);
  if (!cmd.length) die('usage: sc run -- <command> [args...]');
  const { env, profile, shadowed } = currentEnvFull();
  if (profile) {
    console.error(`👤 running as profile "${profile}"`);
    if (shadowed.length) console.error(`   unset for the child: ${shadowed.join(', ')}`);
  }
  // Pass `env` AS the child's environment, never merged back over process.env — the merge is
  // what re-introduced the very keys loadEnvFor had just removed. `env` already carries
  // everything inherited (PATH, HOME, …) minus the credentials this profile does not own.
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env });
  process.exit(r.status === null ? 1 : r.status);
}

async function cmdUser(sub, arg, arg2, args) {
  switch (sub) {
    case undefined:
    case 'list':  return cmdUserList();
    case 'which': return cmdUserWhich();
    case 'add':   return cmdUserAdd(arg, args);
    case 'use': {
      if (!arg && isInteractive()) {
        const names = P.listProfiles();
        if (!names.length) die('no profiles yet — sc user add <name>');
        const picked = await selectOne('Use which profile?', names.map(n => ({
          id: n, label: n.padEnd(18), hint: `${Object.keys(P.readProfile(n)).length} value(s)`,
        })));
        if (!picked) { console.log('cancelled'); return; }
        return cmdUserUse(picked);
      }
      return cmdUserUse(arg);
    }
    case 'map':   return cmdUserMap(arg, arg2);
    case 'unmap': return cmdUserUnmap(arg);
    case 'rm':    return cmdUserRm(arg, args);
    case 'edit':  console.log(P.SC_MD); return;
    default:      return die(`unknown: sc user ${sub}`);
  }
}

// ---------------------------------------------------------------------------
// doctor — live verification
// ---------------------------------------------------------------------------
async function cmdDoctor(args) {
  const env = currentEnv();
  const ids = resolveIds(args) || PROVIDERS.filter(p => p.status !== 'stub').map(p => p.id);
  console.log('\n🩺 sc doctor — live verification against each provider API\n');
  profileBanner();
  console.log('');
  let fails = 0, checked = 0;
  const results = await Promise.all(ids.map(async id => {
    const p = byId.get(id);
    let r;
    try { r = await p.check(env); } catch (e) { r = { ok: false, detail: `check threw: ${e.message}` }; }
    return { p, r };
  }));
  for (const { p, r } of results) {
    const icon = r.ok === true ? '✅' : r.ok === false ? '❌' : '⚪';
    if (r.ok === false) fails++;
    if (r.ok !== null) checked++;
    console.log(`  ${icon} ${p.id.padEnd(14)} ${r.detail}`);
  }
  console.log(`\n  ${checked} verified live, ${fails} failing, ${results.length - checked} not verifiable here.\n`);
  if (fails) process.exit(1);
}

// ---------------------------------------------------------------------------
// preflight — the gate /sc-all runs before it touches anything
// ---------------------------------------------------------------------------
async function cmdPreflight(args) {
  const target = args.target || 'dokploy';
  const ids = TARGET_PROVIDERS[target] || die(`unknown --target "${target}"`);
  const env = currentEnv();

  const missing = [];
  for (const id of ids) {
    for (const v of byId.get(id).vars) {
      if (v.required && !env[v.key]) missing.push({ id, key: v.key });
    }
  }
  if (missing.length === 0) {
    console.log(`✅ preflight ok for --target ${target} (${ids.join(', ')})`);
    return;
  }

  console.log(`\n⚠️ --target ${target} needs ${missing.length} credential(s) that are not set:\n`);
  for (const m of missing) console.log(`   • ${m.key}   (${m.id})`);

  // Auto-launch ONLY on a real terminal. Prompting on a closed or piped stdin does not ask a
  // question, it hangs the job — so CI gets the exact command instead and exits non-zero.
  if (!isInteractive()) {
    console.log(`\n❌ Not a TTY — refusing to prompt. Run this first:\n`);
    console.log(`   node ${path.relative(process.cwd(), __filename)} setup --target ${target}\n`);
    process.exit(1);
  }
  console.log('');
  if (!await confirm('Enter them now?')) die('aborted — deploy not started', 1);
  const updates = await collect(ids);
  if (Object.keys(updates).length) {
    appendExportToShellRc(updates);
    console.log(`\n✅ Wrote ${Object.keys(updates).length} export(s) to ~/.bashrc`);
    // The parent shell cannot be mutated from here, so the caller must re-source before the
    // deploy reads process.env. Say so explicitly rather than letting it fail one step later.
    console.log('\n⚠️ Run `source ~/.bashrc` and re-run /sc-all — this process cannot change the parent shell.');
    process.exit(2);
  }
  die('still missing required credentials', 1);
}


// Bare `sc` on a terminal opens the console rather than printing a wall of usage. On a pipe
// it still prints usage, so `sc | head` and scripts behave the way anyone would expect.
async function cmdMenu() {
  const action = await selectOne('sc — provider + secret control plane', [
    { id: 'providers', label: 'providers', hint: 'registry + safe credential status' },
    { id: 'secrets',   label: 'secrets  ', hint: 'credential status; values never printed' },
    { id: 'setup',     label: 'setup    ', hint: 'hidden credential entry' },
    { id: 'doctor',    label: 'doctor   ', hint: 'live check against each real API' },
    { id: 'update',    label: 'update   ', hint: 'safe git fast-forward self-update' },
    { id: 'audit',     label: 'audit    ', hint: 'metadata-only lifecycle log' },
    { id: 'preflight', label: 'preflight', hint: 'check a /sc-all deploy target' },
    { id: 'users',     label: 'users    ', hint: 'profiles, and which folder uses which' },
    { id: 'which',     label: 'which    ', hint: 'why this directory resolves to that profile' },
    { id: 'quit',      label: 'quit     ', hint: '' },
  ]);
  switch (action) {
    case 'providers': return cmdProvidersList({});
    case 'secrets':   return cmdSecretList(undefined, {});
    case 'setup':     return cmdSetup({});
    case 'doctor':    return cmdDoctor({});
    case 'update':    return cmdUpdate({});
    case 'audit':     return cmdAudit({});
    case 'users':     return cmdUserList();
    case 'which':     return cmdUserWhich();
    case 'preflight': {
      const target = await selectOne('Which /sc-all target?', Object.entries(TARGET_PROVIDERS)
        .map(([t, ids]) => ({ id: t, label: t.padEnd(9), hint: `needs: ${ids.join(', ')}` })));
      if (!target) return;
      return cmdPreflight({ target });
    }
    default: return;
  }
}

// ---------------------------------------------------------------------------
function usage() {
  console.log(`
sc — si-coder provider console + secret control plane

  sc update [--check] [--json]        safe self-update: fetch + fast-forward only
  sc version [--json]                 version, source checkout and git state

  sc providers [--json]               list built-in + custom providers; never secret values
  sc providers show <id>              provider detail (secret values redacted)
  sc providers create <id> --key KEY [--title ...] [--blurb ...]
                                      create a custom provider definition (metadata only)
  sc providers update <id> [--title ...] [--blurb ...]
  sc providers key-add <id> <KEY> [--required] [--public] [--prefix P] [--min-length N]
  sc providers key-rm <id> <KEY> [--yes]
  sc providers delete <id> [--yes]    custom only; also purges its managed credentials

  sc secret list [provider] [--json]  credential state/source only; NO plaintext
  sc secret get <provider> [KEY]      safe read: state/source; plaintext read is disabled
  sc secret set <provider> [KEY]      hidden TTY entry; with KEY also supports:
      --stdin | --from-env NAME | --from-file PATH
                                      secret never belongs in argv/chat
  sc secret rm <provider> [KEY] [--yes]
  sc run -- <cmd> ...                 consume resolved profile secrets in a child process

  sc setup [--providers a,b] [--target t] [--force]
                                      interactive setup wizard
  sc doctor [--providers a,b] [--target t]
                                      LIVE provider verification
  sc preflight --target <dokploy|hybrid|vercel>
                                      gate used by /sc-all
  sc audit [--limit N] [--json]       metadata-only lifecycle audit trail

  sc user                             list profiles + current resolution
  sc user which                       why this directory resolves to that profile
  sc user add <name> [--from-shell]   create a profile
  sc user use <name>                  set fallback profile
  sc user map <folder> <name>         bind folder tree to a profile
  sc user unmap <folder>              drop mapping
  sc user rm <name> [--yes]           delete profile + its credentials
  sc env                              disabled (plaintext export); use sc run

Agent safety contract:
  • agents may LIST/CREATE/UPDATE/DELETE provider metadata and credential status
  • agents must NEVER ask for or pass a plaintext API key in chat/tool JSON/argv
  • new/rotated secrets enter through hidden TTY, a trusted stdin/FD, env, or local file
  • use sc run -- <cmd> so consumers receive secrets without printing them

  --no-profile                        ignore profiles for this one command

  providers: ${PROVIDERS.map(p => p.id).join(', ')}
  targets  : ${Object.keys(TARGET_PROVIDERS).join(', ')}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  NO_PROFILE = Boolean(args['no-profile']);
  const [cmd, sub, arg] = args._;
  switch (cmd) {
    case 'providers':
      if (!sub) return cmdProvidersList(args);
      if (sub === 'show') return cmdProvidersShow(arg);
      if (sub === 'set') return cmdProvidersSet(arg);              // compatibility alias
      if (sub === 'rm') return cmdProvidersRm(arg, args);          // compatibility alias
      if (sub === 'create' || sub === 'add') return cmdProviderCreate(arg, args);
      if (sub === 'update' || sub === 'edit') return cmdProviderUpdate(arg, args);
      if (sub === 'delete') return cmdProviderDelete(arg, args);
      if (sub === 'key-add') return cmdProviderKeyAdd(arg, args._[3], args);
      if (sub === 'key-rm' || sub === 'key-delete') return cmdProviderKeyRm(arg, args._[3], args);
      return die(`unknown: providers ${sub}`);
    case 'secret':
    case 'secrets':
      if (!sub || sub === 'list' || sub === 'status') return cmdSecretList(arg, args);
      if (sub === 'get' || sub === 'show') return cmdSecretShow(arg, args._[3], args);
      if (sub === 'set' || sub === 'put' || sub === 'rotate') return cmdSecretSet(arg, args._[3], args);
      if (sub === 'rm' || sub === 'delete') return cmdSecretRm(arg, args._[3], args);
      return die(`unknown: secret ${sub}`);
    case 'update':    return cmdUpdate(args);
    case 'version':   return cmdVersion(args);
    case 'audit':     return cmdAudit(args);
    case 'user':      return cmdUser(sub, arg, args._[3], args);
    case 'env':       return cmdEnv(args);
    case 'run':       return cmdRun(args);
    case 'setup':     return cmdSetup(args);
    case 'doctor':    return cmdDoctor(args);
    case 'preflight': return cmdPreflight(args);
    case undefined:   return isInteractive() ? cmdMenu() : usage();
    case 'menu':      return cmdMenu();
    case 'help':      return usage();
    default:          usage(); return die(`unknown command "${cmd}"`);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
