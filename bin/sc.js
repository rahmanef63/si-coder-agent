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
const {
  enterAlternateScreen, leaveAlternateScreen, clearAlternateScreen, hideCursor, showCursor,
  selectFinderFrame, waitForEnter, stripAnsi,
} = require(path.resolve(__dirname, '../lib/finder-tui'));
const P = require(path.resolve(__dirname, '../lib/profiles'));
const C = require(path.resolve(__dirname, '../lib/connections'));
const UC = require(path.resolve(__dirname, '../lib/user-control'));
const CC = require(path.resolve(__dirname, '../lib/composio-connections'));
const CP = require(path.resolve(__dirname, '../lib/custom-providers'));
const { audit, readAudit } = require(path.resolve(__dirname, '../lib/audit'));
const { checkUpdate, performUpdate } = require(path.resolve(__dirname, '../lib/update'));
const { planDeploy } = require(path.resolve(__dirname, '../lib/deploy-route'));
const { credentialGuide, humanGuideLines, looksLikeExternalCredential, recommendation } = require(path.resolve(__dirname, '../lib/credential-guidance'));
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
let MENU_MODE = false;
let USER_OVERRIDE = null;
let CONNECTION_OVERRIDES = {};
let _envCache = null;
function invalidateEnvCache() { _envCache = null; }
function currentEnvFull() {
  if (!_envCache) {
    _envCache = USER_OVERRIDE
      ? P.loadEnvForProfile(USER_OVERRIDE, { shellRcEnv: readShellRcEnv(), reason: `selected user ${USER_OVERRIDE}`, connectionOverrides: CONNECTION_OVERRIDES })
      : P.loadEnvFor(process.cwd(), { noProfile: NO_PROFILE, shellRcEnv: readShellRcEnv(), connectionOverrides: CONNECTION_OVERRIDES });
  }
  return _envCache;
}
function currentEnv() { return currentEnvFull().env; }

async function withUserProfile(name, fn, connectionOverrides = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const previous = USER_OVERRIDE;
  const previousConnections = CONNECTION_OVERRIDES;
  USER_OVERRIDE = name;
  CONNECTION_OVERRIDES = { ...connectionOverrides };
  invalidateEnvCache();
  try { return await fn(); }
  finally { USER_OVERRIDE = previous; CONNECTION_OVERRIDES = previousConnections; invalidateEnvCache(); }
}

// One line, printed once, so it is never a mystery which identity a command ran as.
function profileBanner() {
  const { profile, owner, reason, shadowed } = currentEnvFull();
  if (profile) {
    console.log(`  👤 user: ${profile}${owner && owner !== profile ? ` · display owner: ${owner}` : ''}  (${reason})`);
    if (shadowed.length) console.log(`     ignoring ${shadowed.length} var(s) from the shell not owned by this profile: ${shadowed.join(', ')}`);
  }
  else if (P.listProfiles().length) console.log(`  👤 user: none  (${reason}) — \`sc user which\` explains`);
}

function sourceOf(key) {
  const { profile, own, selectedConnections } = currentEnvFull();
  if (profile) {
    const provider = PROVIDERS.find(p => p.vars.some(v => v.key === key));
    const selected = provider ? selectedConnections?.[provider.id] : null;
    if (selected && selected.keyNames.includes(key) && own[key] !== undefined) return `connection:${profile}/${provider.id}/${selected.id}`;
    if (P.readProfile(profile)[key] !== undefined) return `user:${profile}:legacy`;
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

class MenuCommandError extends Error { constructor(message, code = 1) { super(message); this.code = code; this.menuCommand = true; } }
function die(msg, code = 1) {
  if (MENU_MODE) throw new MenuCommandError(msg, code);
  console.error(`❌ ${msg}`); process.exit(code);
}

function storeLabel() {
  const t = writeTarget();
  if (t.kind === 'profile') return `SI-Coder user "${t.name}" credential store (${P.profilePath(t.name)}, mode 0600)`;
  if (t.kind === 'profile-unset') return 'an SI-Coder user mapped/selected for this directory (run `sc user which`, then `sc user use <name>` or `sc user map . <name>`)';
  return 'managed ~/.bashrc block (0600-compatible local shell store; profiles are preferred)';
}

function printCredentialGuide(key, indent = '      ', options = {}) {
  const guideOptions = { store: options.store || storeLabel(), user: options.user || USER_OVERRIDE || undefined, connection: options.connection || undefined };
  const g = credentialGuide(key, guideOptions);
  const c = g.userCard;
  if (!c) {
    for (const line of humanGuideLines(key, guideOptions)) console.log(`${indent}${line}`);
    return;
  }
  console.log(`${indent}${c.title}`);
  console.log(`${indent}${c.message}`);
  if (c.primaryAction?.url) console.log(`${indent}Buka di      : ${c.primaryAction.url}`);
  if (c.getWith) console.log(`${indent}Ambil dengan : ${c.getWith}`);
  if (c.navigationText) console.log(`${indent}Klik         : ${c.navigationText}`);
  if (c.instructions) console.log(`${indent}Catatan      : ${c.instructions}`);
  if (c.saveAction) console.log(`${indent}Simpan lewat : ${c.saveAction}`);
  console.log(`${indent}Simpan di    : penyimpanan aman SI-Coder di perangkat ini`);
  if (c.after) console.log(`${indent}Setelah itu  : ${c.after}`);
}

function printRecommendation(rec) {
  const c = rec.userCard;
  console.log(`\n${rec.label}`);
  if (c) {
    console.log(`Next         : ${c.title}`);
    console.log(`Why          : ${c.reason}`);
    if (c.beforeWeStart?.length) console.log(`Yang dibutuhkan: ${c.beforeWeStart.join(', ')}`);
    console.log(`If you want  : ${c.offer}`);
    return;
  }
  console.log(`Next         : ${rec.next}`);
  console.log(`Why          : ${rec.why}`);
  if (rec.prerequisites?.length) console.log(`Yang dibutuhkan: ${rec.prerequisites.join(', ')}`);
  if (rec.action) console.log(`If you want  : ${rec.action}`);
}

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
      setup: credentialGuide(v.key, { store: storeLabel() }),
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
  if (!id) return;
  const p = byId.get(id) || die(`unknown provider "${id}"`);
  const env = currentEnv();
  console.log(`\n🔌 ${p.id} — ${p.title}${p.status === 'stub' ? '  (STUB: script not implemented)' : ''}`);
  console.log(`   ${p.blurb}\n`);
  for (const v of p.vars) {
    const st = varState(v, env);
    const icon = { set: '✅', MISSING: '❌', INVALID: '❗', unset: '⚪' }[st];
    console.log(`  ${icon} ${v.key}${v.required ? ' (required)' : ''}`);
    if (env[v.key]) console.log(`       value : ${isSecret(v.key) ? `[hidden len=${String(env[v.key]).length}]` : env[v.key]}   [from ${sourceOf(v.key)}]`);
    if (st !== 'set') printCredentialGuide(v.key, '       ');
    else {
      const src = sourceLine(v.key);
      if (src) console.log(`       ↳ ${src}`);
    }
  }
  console.log('');
}


function cmdProviderDefinition(id) {
  const p = byId.get(id) || die(`unknown provider "${id}"`);
  console.log(`
🔌 provider: ${p.id} — ${p.title}`);
  console.log(`   ${p.blurb}`);
  console.log('   connections are user-scoped; provider, source/backend, auth, and scope are separate.\n');
  console.log('  Connection sources:');
  for (const source of C.sourceOptions(p)) {
    console.log(`    • ${source.id} — ${source.label}`);
    if (source.description) console.log(`      ${source.description}`);
    for (const a of C.authOptions(p, source.id)) {
      console.log(`      - ${a.id} — ${a.label} · ${a.scheme} · scope ${a.scope}${a.recommended ? ` · ${a.recommended}` : ''}`);
      if (a.fields?.length) console.log(`        fields: ${a.fields.join(', ')}`);
    }
    if (source.toolkit) console.log(`      toolkit: ${source.toolkit}`);
    if (source.reference) console.log(`      reference: ${source.reference}`);
  }
  console.log('\n  Credential fields (SI-Coder direct only):');
  for (const v of p.vars) {
    console.log(`    ${v.required ? '• provider-required' : '• auth-method scoped'} ${v.key}`);
    if (v.url) console.log(`      create/manage: ${v.url}`);
    if (v.navigation?.length) console.log(`      click: ${v.navigation.join(' → ')}`);
    if (v.note) console.log(`      note: ${v.note}`);
  }
  console.log('');
}

// A provider list shaped for the arrow-key pickers, annotated with live state so the user
// can see what needs attention without leaving the menu.
function providerItems(env = currentEnv()) {
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
function providerItemsForUser(name) {
  return PROVIDERS.map(p => {
    const st = UC.providerStatus(name, p.id);
    let mark = '⚪';
    if (st.invalid) mark = '❗';
    else if (st.missingRequired && (st.connectionCount || st.stored)) mark = '❌';
    else if (st.connectionCount || st.stored) mark = '✅';
    const suffix = st.connectionCount ? `×${st.connectionCount}` : st.stored ? 'legacy' : '—';
    return {
      id: p.id,
      label: `${mark} ${p.id.padEnd(14)} ${suffix}`,
      hint: `${p.status === 'stub' ? '(stub) ' : ''}${p.blurb}${st.connection ? ` · default: ${st.connectionLabel}` : st.legacy && st.stored ? ' · legacy credentials' : ''}`,
      needsAttention: Boolean(st.invalid || (st.missingRequired && (st.connectionCount || st.stored))),
      stub: p.status === 'stub', hasAny: Boolean(st.connectionCount || st.stored),
      preview: UC.previewForProvider(name, p.id),
    };
  });
}

function connectionItemsForUser(name, providerId) {
  const p = byId.get(providerId) || die(`unknown provider "${providerId}"`);
  const rows = UC.connectionsStatus(name, providerId).sort((a,b) => Number(b.isDefault)-Number(a.isDefault) || a.label.localeCompare(b.label));
  return rows.map(c => ({
    id: `connection:${c.id}`, kind: 'branch', pathLabel: c.label,
    label: `${c.isDefault ? '★' : ' '} ${c.label}`,
    hint: `${c.sourceLabel} · ${c.scheme} · ${c.scope}${c.external ? ` · ${c.state}` : ` · ${c.stored}/${c.total} field(s)`}`,
    preview: UC.previewForConnection(name, providerId, c.id),
  }));
}

function credentialItemsForUser(name, providerId, connectionId = null) {
  const p = byId.get(providerId) || die(`unknown provider "${providerId}"`);
  const status = UC.providerStatus(name, providerId, connectionId);
  if (connectionId && status.external) return [];
  return status.credentials.map(c => ({
    id: `credential:${c.key}`,
    kind: 'branch',
    pathLabel: c.key,
    label: `${c.stored ? (c.valid ? '✅' : '❗') : (c.required ? '❌' : '⚪')} ${c.key}`,
    hint: `${c.state} · belongs to ${name}${status.connectionLabel ? ` / ${status.connectionLabel}` : ' / legacy'}`,
    preview: UC.previewForCredential(name, providerId, c.key, connectionId),
  }));
}

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
  if (!id) { console.log('cancelled'); return null; }
  return id;
}

// ---------------------------------------------------------------------------
// setup / set — collect values
// ---------------------------------------------------------------------------
async function promptForVar(v, { force = false, user, connection, store } = {}) {
  console.log('');
  console.log(`  ${v.key}${v.required ? '' : '  (optional — press Enter to skip)'}`);
  printCredentialGuide(v.key, '    ', { user, connection, store });
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
    invalidateEnvCache();
    console.log(`\n✅ Wrote ${Object.keys(updates).length} value(s) to profile "${t.name}" (${P.profilePath(t.name)})`);
    console.log('   Use `sc run -- <cmd>` to consume them without revealing plaintext.');
    return t;
  }
  if (t.kind === 'profile-unset') {
    die('profiles exist but none governs this directory — pick one with `sc user use <name>` or map it with `sc user map . <name>`');
  }
  appendExportToShellRc(updates);
  invalidateEnvCache();
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
  printRecommendation(recommendation({ next: 'verifikasi provider yang baru diset', why: 'format key saja tidak membuktikan key masih valid', action: 'sc doctor' }));
}

async function cmdProvidersSet(id) {
  if (!isInteractive()) die('sc providers set needs a TTY.');
  if (!id) id = await pickProvider('Re-enter credentials for which provider?');
  if (!id) return;
  byId.get(id) || die(`unknown provider "${id}"`);
  console.log(`\n🔁 re-entering every var for "${id}" (existing values will be replaced)\n`);
  const updates = await collect([id], { force: true });
  if (Object.keys(updates).length === 0) { console.log('\nNothing entered — no change.'); return; }
  persist(updates);
}

async function cmdProvidersRm(id, args) {
  if (!id) id = await pickProvider('Remove credentials for which provider?');
  if (!id) return;
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
    invalidateEnvCache();
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
    navigation: typeof args.navigation === 'string' ? args.navigation : undefined,
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

function purgeKeysEverywhere(keys, { providerId = null, dropProviderConnections = false } = {}) {
  const profiles = [];
  const connections = [];
  for (const name of P.listProfiles()) {
    const removed = P.removeFromProfile(name, keys);
    if (removed.length) profiles.push({ profile: name, keys: removed });
    if (providerId) {
      for (const row of C.list(name, providerId)) {
        if (dropProviderConnections) {
          C.remove(name, providerId, row.id);
          connections.push({ profile: name, provider: providerId, connection: row.id, removedKeys: row.keyNames });
        } else {
          const removedKeys = C.removeValues(name, providerId, row.id, keys);
          if (removedKeys.length) connections.push({ profile: name, provider: providerId, connection: row.id, removedKeys });
        }
      }
    }
  }
  const shell = removeExportsFromShellRc(keys);
  return { profiles, connections, shell };
}

function cmdProviderCreate(id, args) {
  if (!id) die('usage: sc providers create <id> --key ENV_KEY [--title ...] [--blurb ...]');
  if (!args.key || typeof args.key !== 'string') die('sc providers create requires --key ENV_KEY');
  if (!args.public && looksLikeExternalCredential(args.key) && typeof args.url !== 'string') die(`custom credential ${args.key} requires --url https://... so agents can always show where to create it`);
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
  const purge = purgeKeysEverywhere(removed.vars.map(v => v.key), { providerId: id, dropProviderConnections: true });
  audit('provider.delete', { provider: id, keyNames: removed.vars.map(v => v.key), profilesTouched: purge.profiles.map(x => x.profile), connectionsRemoved: purge.connections.length });
  console.log(`✅ deleted custom provider ${id} and purged managed credential keys`);
  if (purge.shell.unmanaged.length) console.log(`⚠️ user-owned exports outside the si-coder block were left untouched: ${purge.shell.unmanaged.join(', ')}`);
  console.log('   Existing values already exported in THIS shell remain until that shell exits.');
}

function cmdProviderKeyAdd(id, key, args) {
  assertCustom(id);
  if (!key) die('usage: sc providers key-add <id> <ENV_KEY> [--required] [--public]');
  if (!args.public && looksLikeExternalCredential(key) && typeof args.url !== 'string') die(`custom credential ${key} requires --url https://... so agents can always show where to create it`);
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
  const purge = purgeKeysEverywhere([v.key], { providerId: id });
  audit('provider.key-remove', { provider: id, keyName: v.key, profilesTouched: purge.profiles.map(x => x.profile), connectionsTouched: purge.connections.length });
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
      setup: credentialGuide(v.key, { store: storeLabel() }),
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
    setup: credentialGuide(v.key, { store: storeLabel() }),
  }));
  if (args.json) return console.log(JSON.stringify({ credentials: out }, null, 2));
  for (const row of out) {
    console.log(`${row.provider}.${row.key}: ${row.state} from ${row.source} (plaintext read disabled)`);
    if (row.state !== 'set') printCredentialGuide(row.key, '  ');
  }
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
  printRecommendation(recommendation({ next: `verifikasi ${providerId}`, why: 'memastikan credential valid dan milik account yang benar sebelum dipakai', needs: ['credential sudah tersimpan'], action: `sc doctor --providers ${providerId}` }));
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
  invalidateEnvCache();
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
  const records = P.listProfileRecords();
  const st = ensureScMd();
  const { profile, reason } = P.resolveProfile();
  console.log('\n👥 users\n');
  if (!records.length) {
    console.log('  (none yet)\n\n  sc user add <name>        create one\n');
    return;
  }
  for (const r of records) {
    const marks = [];
    if (r.name === st.active) marks.push('active');
    if (r.name === profile) marks.push('current dir');
    console.log(`  ${r.name === profile ? '❯' : ' '} ${r.name.padEnd(16)} ${String(r.connections || 0).padStart(2)} connection(s) · ${String(r.keys).padStart(2)} field(s)${r.legacyKeys ? ` · ${r.legacyKeys} legacy` : ''}${marks.length ? '   [' + marks.join(', ') + ']' : ''}`);
  }
  console.log(`\n  current user: ${profile || 'none'}  (${reason})`);
  console.log(`  folder map : ${P.SC_MD}`);
  console.log(`  ownership  : ${P.PROFILE_META}\n`);
}

function cmdUserWhich() {
  const { profile, reason, mapping, state } = P.resolveProfile();
  console.log(`\n📍 cwd      : ${process.cwd()}`);
  console.log(`   user     : ${profile || '(none)'}`);
  if (profile && P.profileOwner(profile) !== profile) console.log(`   display  : ${P.profileOwner(profile)}`);
  console.log(`   because  : ${reason}`);
  if (mapping) console.log(`   rule     : ${mapping.path} → ${mapping.profile}`);
  if (profile && !P.profileExists(profile)) {
    console.log(`   ⚠️ sc.md names user "${profile}" but its credential store does not exist`);
  }
  if (state.mappings.length) {
    console.log('\n   all rules (longest match wins):');
    for (const m of state.mappings) {
      const dead = P.profileExists(m.profile) ? '' : '   ⚠️ profile missing';
      console.log(`     ${m.path.padEnd(38)} → ${m.profile}${dead}`);
    }
  }
  console.log(`\n   folder map : ${P.SC_MD}`);
  console.log(`   ownership  : ${P.PROFILE_META}\n`);
}

function cmdUserProfileInfo(name) {
  if (!name || !P.profileExists(name)) die(`no such profile "${name || ''}"`);
  const u = UC.showUser(name);
  console.log(`\n👤 user: ${name}`);
  console.log(`   display owner: ${u.owner}`);
  console.log(`   connections   : ${u.connectionCount}`);
  console.log(`   credential fields: ${u.credentialCount} total · ${u.legacyCredentialCount} legacy · values hidden`);
  console.log(`   connection store : ${u.connectionStore}`);
  console.log(`   legacy store     : ${u.store}`);
  console.log(`   active/default   : ${u.isDefault ? 'yes' : 'no'}`);
  console.log(`   folders          : ${u.folders.length ? u.folders.join(', ') : '(none)'}`);
  if (u.providers.length) console.log(`   providers        : ${u.providers.map(p => `${p.id}${p.connectionCount ? ` ×${p.connectionCount}` : p.stored ? ' legacy' : ''}`).join(' · ')}`);
  if (u.legacyCredentialCount) console.log(`   legacy env keys  : ${u.credentialKeys.join(', ')}`);
  console.log('');
}

async function cmdUserOwner(name, owner) {
  if (!name) die('usage: sc user owner <profile> [owner]');
  if (!P.profileExists(name)) die(`no such profile "${name}"`);
  if (!owner) {
    if (!isInteractive()) die('owner is required on a non-TTY: sc user owner <profile> <owner>');
    owner = await askVisible(`Owner for ${name} [${P.profileOwner(name)}]: `);
    if (!owner) return console.log('unchanged');
  }
  const meta = P.setProfileOwner(name, owner);
  invalidateEnvCache();
  audit('profile.owner', { profile: name, owner: meta.owner });
  console.log(`✅ ${name} credentials belong to user/account: ${meta.owner}`);
}

async function cmdUserAdd(name, args) {
  let enteredInteractively = false;
  if (!name) {
    if (!isInteractive()) die('usage: sc user add <name> [--owner <user>] [--from-shell]');
    name = await askVisible('New profile name: ');
    enteredInteractively = true;
  }
  P.assertName(name);
  if (P.profileExists(name) && !args.force) die(`profile "${name}" already exists (use --force to overwrite)`);
  let owner = typeof args.owner === 'string' ? P.assertOwner(args.owner) : name;
  if (enteredInteractively && typeof args.owner !== 'string') {
    const answer = await askVisible(`Owner/user for ${name} [${name}]: `);
    if (answer) owner = P.assertOwner(answer);
  }
  let updates = {};
  if (args['from-shell']) {
    const env = { ...readShellRcEnv(), ...process.env };
    for (const v of PROVIDERS.flatMap(p => p.vars)) if (env[v.key]) updates[v.key] = env[v.key];
    console.log(`  imported ${Object.keys(updates).length} credential value(s) from the current environment`);
  }
  P.writeProfile(name, updates);
  P.setProfileOwner(name, owner);
  const st = ensureScMd();
  if (!st.active) P.writeScMd({ active: name, mappings: st.mappings });
  invalidateEnvCache();
  audit('profile.create', { profile: name, owner, importedKeys: Object.keys(updates).length });
  console.log(`✅ profile "${name}" created for user/account "${owner}"`);
  console.log(`   credentials: ${P.profilePath(name)} (0600)`);
  if (!st.active) console.log('   set as the active fallback profile');
  console.log(`\n   next: sc user map <folder> ${name}    (or: sc user use ${name})`);
}


function userProviderSummary(name) {
  return UC.userProviders(name).map(p => ({ id:p.id, stored:p.stored, total:p.total, invalid:p.invalid, connectionCount:p.connectionCount || 0, defaultConnection:p.defaultConnection }));
}

function cmdUserConnections(name, providerId) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (providerId && !byId.has(providerId)) die(`unknown provider "${providerId}"`);
  const rows = UC.connectionsStatus(name, providerId || null);
  console.log(`\n🔗 connections for user: ${name} — values hidden\n`);
  if (!rows.length) {
    console.log('  (no named connections yet)');
    if (!providerId) console.log('  Existing legacy provider credentials can be migrated with: sc user connection-migrate ' + name);
    console.log('');
    return;
  }
  for (const row of rows) {
    console.log(`  ${row.provider.padEnd(14)} ${row.id.padEnd(18)} ${row.label}${row.isDefault ? '   [default]' : ''}`);
    console.log(`    source ${row.sourceLabel} · auth ${row.scheme} · scope ${row.scope} · ${row.external ? row.state : `${row.stored}/${row.total} credential field(s) · ${row.state}`}`);
  }
  console.log('');
}

async function cmdUserConnectionAdd(name, providerId, label, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const p = byId.get(providerId) || die(`unknown provider "${providerId || ''}"`);
  const sources = C.sourceOptions(p);
  let source = typeof args.source === 'string' ? args.source : null;
  let authMethod = typeof args.auth === 'string' ? args.auth : null;
  if (!source && authMethod) {
    const matches = sources.filter(src => C.authOptions(p, src.id).some(a => a.id === authMethod));
    source = matches.length === 1 ? matches[0].id : 'sc';
  }
  if (!source) {
    if (!isInteractive()) die(`--source is required on a non-TTY; choose: ${sources.map(x=>x.id).join(' | ')}`);
    source = await selectOne(`Connection method for ${providerId}`, sources.map(x => ({ id:x.id, label:x.label, hint:x.description || '' })));
    if (!source) return console.log('cancelled');
  }
  const sourceMeta = C.sourceOption(p, source);
  const options = C.authOptions(p, source);
  if (!authMethod) {
    if (options.length === 1) authMethod = options[0].id;
    else {
      if (!isInteractive()) die(`--auth is required on a non-TTY for source ${source}; choose: ${options.map(x=>x.id).join(' | ')}`);
      authMethod = await selectOne(`Authentication for ${providerId} via ${sourceMeta.label}`, options.map(o => ({ id:o.id, label:o.label, hint:`${o.scheme} · ${o.scope}${o.recommended ? ` · ${o.recommended}` : ''}` })));
      if (!authMethod) return console.log('cancelled');
    }
  }
  const method = C.authOption(p, source, authMethod);
  if (!label) {
    if (!isInteractive()) die('connection label is required on a non-TTY');
    label = await askVisible(`Label for this ${providerId} connection: `);
    if (!label) return console.log('cancelled');
  }
  const external = source === 'sc' ? null : {
    system: source, toolkit: sourceMeta.toolkit || providerId, alias: C.slugify(label), lastKnownStatus: 'UNLINKED', checkedAt: null,
  };
  const row = C.create(name, providerId, { label, source, authMethod, scope: method.scope, setDefault: Boolean(args.default), external });
  audit('connection.create', { profile:name, provider:providerId, connection:row.id, label:row.label, source, authMethod, scope:row.scope, external:source !== 'sc' });
  invalidateEnvCache();
  console.log(`✅ connection "${row.label}" created for ${name}/${providerId}${row.isDefault ? ' and set as default' : ''}`);
  console.log(`   source: ${sourceMeta.label} · auth: ${method.scheme} · scope ${method.scope}`);
  if (source !== 'sc') {
    console.log(`   status: needs authorization · toolkit ${sourceMeta.toolkit || providerId}`);
    if (sourceMeta.reference) console.log(`   reference: ${sourceMeta.reference}`);
    console.log('   no provider credential was requested or stored locally.');
  } else {
    console.log(`   next: sc user credential-set ${name} ${providerId} <KEY> --connection ${row.id}`);
  }
  return row;
}
function cmdUserConnectionGuide(name, providerId, id = null) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const p = byId.get(providerId) || die(`unknown provider "${providerId || ''}"`);
  const connection = id ? C.get(name, providerId, id) : C.selected(name, providerId);
  if (!connection) {
    console.log(`
🔐 connection methods for ${name}/${providerId}
`);
    for (const source of C.sourceOptions(p)) {
      console.log(`  ${source.id} — ${source.label}${source.description ? ` · ${source.description}` : ''}`);
      for (const method of C.authOptions(p, source.id)) console.log(`    ${method.id} — ${method.label} · ${method.scheme} · scope ${method.scope}`);
    }
    console.log('');
    return;
  }
  const source = C.sourceOption(p, connection.source || 'sc');
  const method = C.authOption(p, connection.source || 'sc', connection.authMethod);
  console.log(`
🔗 ${name} › ${providerId} › ${connection.label}`);
  console.log(`   source : ${source.label} (${connection.source || 'sc'})`);
  console.log(`   auth   : ${method.label} (${method.scheme})`);
  console.log(`   scope  : ${connection.scope || method.scope}`);
  console.log(`   default: ${connection.isDefault ? 'yes' : 'no'}`);
  if ((connection.source || 'sc') !== 'sc') {
    const ext = connection.external || {};
    console.log(`   system : ${ext.system || connection.source}`);
    if (ext.toolkit || source.toolkit) console.log(`   toolkit: ${ext.toolkit || source.toolkit}`);
    if (ext.connectedAccountId) console.log(`   account: ${ext.connectedAccountId}`);
    if (ext.authConfigId) console.log(`   auth config: ${ext.authConfigId}`);
    if (ext.alias) console.log(`   alias  : ${ext.alias}`);
    console.log(`   status : ${ext.lastKnownStatus || 'UNLINKED'}`);
    if (source.reference) console.log(`   reference: ${source.reference}`);
    console.log('   local provider secret: none.');
  } else {
    const fields=C.connectionFields(p,connection);
    console.log(`   fields : ${fields.map(v=>v.key).join(', ') || '(none)'}`);
    for (const v of fields) {
      const g=credentialGuide(v.key,{user:name,connection:connection.id,store:`SI-Coder connection "${connection.label}" (${C.connectionPath(name,providerId,connection.id)}, mode 0600)`,override:method.guidance?.[v.key] || null});
      if (g.referenceUrl) console.log(`   ${v.key} → ${g.referenceUrl}`);
      if (g.navigationText) console.log(`     click: ${g.navigationText}`);
    }
  }
  console.log('');
  return { connection, source, method };
}

function cmdUserConnectionUse(name, providerId, id) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const row = C.setDefault(name, providerId, id);
  audit('connection.default', { profile:name, provider:providerId, connection:id });
  invalidateEnvCache();
  console.log(`✅ default ${providerId} connection for ${name}: ${row.label} (${row.id})`);
  return row;
}
async function cmdUserConnectionAuthorize(name, providerId, id, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (!id) die('connection id is required');
  const out = await CC.authorize(name, providerId, id, {
    authConfigId: args['auth-config'] || null,
    brokerConnection: args['composio-connection'] || null,
    callbackUrl: args.callback || null,
  });
  audit('connection.external.authorize', { profile:name, provider:providerId, connection:id, source:'composio', connectedAccountId:out.connectedAccountId, authConfigId:out.authConfigId, brokerConnection:out.brokerConnection });
  invalidateEnvCache();
  console.log(`✅ Composio authorization started for ${name}/${providerId}/${id}`);
  console.log(`   status : ${out.status}`);
  console.log(`   account: ${out.connectedAccountId}`);
  console.log(`   open   : ${out.redirectUrl}`);
  if (out.expiresAt) console.log(`   link expires: ${out.expiresAt}`);
  console.log('   SI-Coder stored only external ids/status; provider tokens remain in Composio.');
  return out;
}

async function cmdUserConnectionSync(name, providerId, id) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (!id) die('connection id is required');
  const out = await CC.sync(name, providerId, id);
  audit('connection.external.sync', { profile:name, provider:providerId, connection:id, source:'composio', status:out.status, connectedAccountId:out.connectedAccountId });
  invalidateEnvCache();
  console.log(`✅ ${name}/${providerId}/${id} · Composio ${out.status}`);
  return out;
}

async function cmdConnectionMetadataMigrate(args = {}) {
  if (!args.yes) {
    if (!isInteractive()) die('connection metadata migration requires --yes on a non-TTY');
    if (!(await confirm('Migrate connection metadata v1 → v2 with a 0600 backup?'))) return console.log('cancelled');
  }
  const result = C.migrateMetadata();
  audit('connection.metadata.migrate', { fromVersion:result.fromVersion, toVersion:result.toVersion, changed:result.changed, backup:result.backup ? path.basename(result.backup) : null });
  console.log(result.changed ? `✅ connection metadata migrated v${result.fromVersion} → v${result.toVersion}` : `✅ connection metadata already v${result.toVersion}`);
  if (result.backup) console.log(`   backup: ${result.backup}`);
  return result;
}

async function cmdUserConnectionLabel(name, providerId, id, label) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (!label) {
    if (!isInteractive()) die('usage: sc user connection-label <user> <provider> <connection> <label>');
    label = await askVisible(`New label for ${providerId}/${id}: `);
    if (!label) return console.log('unchanged');
  }
  const row=C.setLabel(name,providerId,id,label);
  audit('connection.label', { profile:name, provider:providerId, connection:id, label:row.label });
  console.log(`✅ renamed connection label: ${row.label}`);
  return row;
}
async function cmdUserConnectionRm(name, providerId, id, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const before=C.get(name,providerId,id);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to delete a connection without --yes on a non-TTY');
    const typed=await askVisible(`Type ${id} to delete connection "${before.label}": `);
    if (typed!==id) return console.log('aborted');
  }
  const row=C.remove(name,providerId,id);
  audit('connection.delete', { profile:name, provider:providerId, connection:id, label:row.label, keyCount:row.keyCount });
  invalidateEnvCache();
  console.log(`✅ deleted ${name}/${providerId}/${row.label}; ${row.keyCount} credential value(s) removed without displaying them`);
}
async function cmdUserConnectionMigrate(name, args = {}, providerId = null) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const legacy=P.readProfile(name);
  if (!Object.keys(legacy).length) return console.log(`✅ ${name} has no legacy credential values to migrate`);
  if (!args.yes) {
    if (!isInteractive()) die('refusing legacy connection migration without --yes on a non-TTY');
    if (!await confirm(`Migrate ${Object.keys(legacy).length} legacy credential field(s) for user "${name}" into named provider connections? Values stay local and hidden.`)) return console.log('aborted');
  }
  const providerRows = providerId ? [byId.get(providerId) || die(`unknown provider \"${providerId}\"`)] : PROVIDERS;
  const result=C.migrateLegacy(name, legacy, providerRows, { removeLegacy: keys => P.removeFromProfile(name, keys) });
  invalidateEnvCache();
  audit('connection.migrate-legacy', { profile:name, providers:result.created.map(x=>x.provider), keyNames:result.migratedKeys });
  console.log(`✅ migrated ${result.migratedKeys.length} legacy credential value(s) into ${result.created.length} named connection(s); values hidden`);
  for (const row of result.created) console.log(`   ${row.provider}/${row.connection} — ${row.label} · ${row.authMethod} · ${row.keyCount} field(s)`);
  return result;
}

function cmdUserCredentials(name, providerId, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const providers = providerId ? [byId.get(providerId) || die(`unknown provider "${providerId}"`)] : PROVIDERS;
  console.log(`\n🔐 credentials for user: ${name} — values hidden\n`);
  let shown=0;
  for (const p of providers) {
    const status=UC.providerStatus(name,p.id,typeof args.connection==='string'?args.connection:null);
    if (!providerId && status.stored===0 && status.connectionCount===0) continue;
    shown++;
    console.log(`  ${p.id}  ${status.connection ? `${status.connectionLabel} (${status.connection})` : 'legacy'}  ${status.stored}/${status.total}${status.connectionCount>1?` · ${status.connectionCount} connections`:''}`);
    for (const c of status.credentials) {
      const mark=c.stored?(c.valid?'✅':'❗'):(c.required?'❌':'⚪');
      console.log(`    ${mark} ${c.key.padEnd(34)} ${c.state} · owner ${name}${status.connection?` · connection ${status.connection}`:''}`);
    }
  }
  if (!shown) console.log('  (no credentials stored for this user)');
  console.log('');
}

function cmdUserCredentialStatus(name, providerId, key, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const connection=typeof args.connection==='string'?args.connection:null;
  const c=UC.credentialStatus(name,providerId,key,connection);
  console.log(`${name} › ${providerId}${c.connectionLabel?` › ${c.connectionLabel}`:''} › ${key}: ${c.state} (plaintext read disabled)`);
  if (!c.stored || !c.valid) printCredentialGuide(key,'  ',{ user:name, connection:c.connection || undefined, store:c.setup?.saveDestination });
}

async function cmdUserCredentialSet(name, providerId, key, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const p=byId.get(providerId)||die(`unknown provider "${providerId || ''}"`);
  const explicit=typeof args.connection==='string'?args.connection:null;
  const conn=C.selected(name,providerId,explicit);
  if (!conn) return withUserProfile(name, async () => key ? cmdSecretSet(providerId,key,args) : cmdProvidersSet(providerId));
  const method=C.authOption(p,conn.source || 'sc',conn.authMethod);
  if ((conn.source || 'sc') !== 'sc') die(`${providerId}/${conn.label} uses ${conn.source} / ${method.scheme}; provider credentials are external, so use the connection authorization flow instead of entering a local key`);
  const fields=C.connectionFields(p,conn);
  const store=`SI-Coder connection "${conn.label}" (${C.connectionPath(name,providerId,conn.id)}, mode 0600)`;
  if (key) {
    const v=fields.find(x=>x.key===key)||die(`${providerId}/${conn.id} auth method ${conn.authMethod} does not use ${key}`);
    printCredentialGuide(key,'  ',{user:name,connection:conn.id,store});
    const {value,source}=await readSecretInput(v,args);
    C.writeValues(name,providerId,conn.id,{[key]:value});
    audit('connection.credential.set',{profile:name,provider:providerId,connection:conn.id,keyName:key,inputSource:source});
    invalidateEnvCache();
    console.log(`✅ stored ${providerId}/${conn.label}.${key}; value not displayed`);
    return;
  }
  if (!isInteractive()) die('setting all connection fields requires a TTY; specify one KEY with --stdin/--from-env/--from-file');
  const existing=C.readValues(name,providerId,conn.id), updates={};
  for (const v of fields) {
    const value=await promptForVar(v,{force:true,user:name,connection:conn.id,store});
    if (value!==null) updates[v.key]=value;
  }
  if (Object.keys(updates).length) C.writeValues(name,providerId,conn.id,updates);
  audit('connection.credentials.set',{profile:name,provider:providerId,connection:conn.id,keyNames:Object.keys(updates)});
  invalidateEnvCache();
  console.log(`✅ updated ${Object.keys(updates).length} field(s) in ${providerId}/${conn.label}; values hidden`);
}

async function cmdUserCredentialRm(name, providerId, key, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  const explicit=typeof args.connection==='string'?args.connection:null;
  const conn=C.selected(name,providerId,explicit);
  if (!conn) return withUserProfile(name,()=>cmdSecretRm(providerId,key,args));
  const p=byId.get(providerId)||die(`unknown provider "${providerId}"`);
  if ((conn.source || 'sc') !== 'sc') die(`${providerId}/${conn.label} uses ${conn.source}; it has no local provider credentials to remove`);
  const fields=C.connectionFields(p,conn);
  const keys=key?[fields.find(v=>v.key===key)?.key||die(`${providerId}/${conn.id} does not define ${key}`)]:fields.map(v=>v.key);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to remove connection credentials without --yes on a non-TTY');
    if (!await confirm(`Remove ${keys.join(', ')} from connection "${conn.label}"?`)) return console.log('aborted');
  }
  const removed=C.removeValues(name,providerId,conn.id,keys);
  audit('connection.credential.remove',{profile:name,provider:providerId,connection:conn.id,keyNames:removed});
  invalidateEnvCache();
  console.log(removed.length?`✅ removed ${removed.join(', ')} from ${conn.label}`:'nothing to remove');
}

async function cmdUserImportCurrent(name, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to import shell credentials without --yes on a non-TTY');
    if (!await confirm(`Import known provider credentials from the current shell into user "${name}"? Existing user credentials stay unchanged.`)) return console.log('aborted');
  }
  const source = { ...readShellRcEnv(), ...process.env };
  const result = P.importProfileFromEnv(name, source, { overwrite: Boolean(args.force || args.overwrite) });
  invalidateEnvCache();
  audit('profile.import-current', { profile: name, keyNames: result.keys, overwrite: Boolean(args.force || args.overwrite) });
  console.log(`✅ imported ${result.keys.length} credential(s) into user "${name}"; values hidden`);
  if (result.keys.length) console.log(`   keys: ${result.keys.join(', ')}`);
  else console.log('   nothing new to import');
  return result;
}

async function cmdUserDuplicate(source, target, args = {}) {
  if (!source || !P.profileExists(source)) die(`no such source user "${source || ''}"`);
  if (!target) {
    if (!isInteractive()) die('usage: sc user duplicate <source> <target> [--replace-empty]');
    target = await askVisible(`Duplicate ${source} as user: `);
    if (!target) return console.log('cancelled');
  }
  P.assertName(target);
  let replaceEmpty = Boolean(args['replace-empty']);
  if (P.profileExists(target)) {
    const count = Object.keys(P.readProfile(target)).length;
    if (count > 0) die(`user "${target}" already has ${count} credential(s); refusing to overwrite`);
    if (!replaceEmpty) {
      if (!isInteractive()) die(`user "${target}" already exists but is empty; pass --replace-empty to fill it safely`);
      replaceEmpty = await confirm(`User "${target}" exists but has no credentials. Fill it with a copy of ${source}?`);
      if (!replaceEmpty) return console.log('aborted');
    }
  }
  const owner = typeof args.owner === 'string' ? args.owner : target;
  const result = P.duplicateProfile(source, target, { owner, replaceEmpty });
  invalidateEnvCache();
  audit('profile.duplicate', { source, target, keyNames: result.keys, connections: result.connections || 0 });
  console.log(`✅ duplicated user "${source}" → "${target}" with ${result.connections || 0} connection(s) + ${result.keys.length} legacy field(s); values hidden`);
  console.log('   Each copied credential is now independently stored under the target user and can be rotated without changing the source user.');
  return target;
}

async function cmdUserRename(source, target) {
  if (!source || !P.profileExists(source)) die(`no such user "${source || ''}"`);
  if (!target) {
    if (!isInteractive()) die('usage: sc user rename <source> <target>');
    target = await askVisible(`Rename user ${source} to: `);
    if (!target) return console.log('cancelled');
  }
  const result = P.renameProfile(source, target);
  invalidateEnvCache();
  audit('profile.rename', { source, target });
  console.log(`✅ renamed user "${source}" → "${target}"; default and folder mappings were migrated`);
  return result.target;
}

function cmdUserUse(name) {
  if (!name) die('usage: sc user use <name>');
  if (!P.profileExists(name)) die(`no such profile "${name}" — sc user list`);
  const st = ensureScMd();
  P.writeScMd({ active: name, mappings: st.mappings });
  invalidateEnvCache();
  audit('profile.default', { profile: name });
  console.log(`✅ default user: ${name}`);
  const resolved = P.resolveProfile();
  if (resolved.mapping && resolved.profile !== name) {
    console.log(`   note: current folder is explicitly mapped to ${resolved.profile}; use \`sc user map . ${name}\` to switch this folder too.`);
  }
}

function cmdUserMap(dir, name) {
  if (!dir || !name) die('usage: sc user map <folder> <profile>');
  if (!P.profileExists(name)) die(`no such profile "${name}" — sc user list`);
  const st = ensureScMd();
  const shown = dir === '.' ? process.cwd() : dir;
  const resolved = path.resolve(P.expandHome(shown));
  const mappings = st.mappings.filter(m => m.resolved !== resolved);
  mappings.push({ path: shown, resolved, profile: name });
  mappings.sort((a, b) => a.resolved.localeCompare(b.resolved));
  P.writeScMd({ active: st.active, mappings });
  invalidateEnvCache();
  audit('profile.map', { profile: name, path: shown });
  console.log(`✅ ${shown} → user ${name}`);
}

function cmdUserUnmap(dir) {
  if (!dir) die('usage: sc user unmap <folder>');
  const st = ensureScMd();
  const resolved = path.resolve(P.expandHome(dir === '.' ? process.cwd() : dir));
  const kept = st.mappings.filter(m => m.resolved !== resolved);
  if (kept.length === st.mappings.length) die(`no rule for ${dir}`);
  const removedRule = st.mappings.find(m => m.resolved === resolved);
  P.writeScMd({ active: st.active, mappings: kept });
  invalidateEnvCache();
  audit('profile.unmap', { profile: removedRule?.profile, path: dir });
  console.log(`✅ removed the rule for ${dir}`);
}

async function cmdUserRm(name, args) {
  if (!name) die('usage: sc user rm <name> [--yes]');
  if (!P.profileExists(name)) die(`no such user "${name}"`);
  const before = UC.showUser(name);
  if (!args.yes) {
    if (!isInteractive()) die('refusing to delete a user without --yes on a non-TTY');
    console.log(`
⚠️ This deletes user "${name}" and ${before.credentialCount} stored credential(s).`);
    if (before.isDefault) console.log('   This user is currently the default.');
    if (before.folders.length) console.log(`   Folder mappings removed: ${before.folders.join(', ')}`);
    const typed = await askVisible(`Type ${name} to confirm deletion: `);
    if (typed !== name) { console.log('aborted'); return; }
  }
  P.deleteProfile(name);
  const st = ensureScMd();
  P.writeScMd({
    active: st.active === name ? null : st.active,
    mappings: st.mappings.filter(m => m.profile !== name),
  });
  invalidateEnvCache();
  audit('profile.delete', {
    profile: name,
    credentialCount: before.credentialCount,
    wasDefault: before.isDefault,
    folderCount: before.folders.length,
  });
  console.log(`✅ deleted user "${name}", its credential store, metadata, and folder rules`);
}

async function cmdUserVerify(name, providerId, args = {}) {
  if (!name || !P.profileExists(name)) die(`no such user "${name || ''}"`);
  if (providerId && !byId.has(providerId)) die(`unknown provider "${providerId}"`);
  const connection = providerId && typeof args.connection === 'string' ? args.connection : null;
  const overrides = connection ? { [providerId]: connection } : {};
  return withUserProfile(name, () => cmdDoctor(providerId ? { providers: providerId } : {}), overrides);
}

// `sc env` used to print plaintext export lines for command substitution. That makes a
// credential-readable API surface and is incompatible with agent-safe storage. Keep the
// command name only as a fail-closed migration message; `sc run` is the non-exfiltrating path.
function cmdEnv() {
  die('plaintext credential export is disabled — use `sc run -- <command>` so the child receives the resolved profile without printing it');
}


// Run any command with the resolved profile injected. Keeps secrets out of the parent shell.
function parseRunConnectionOverrides(spec, profile) {
  if (!spec) return {};
  if (!profile) die('--connection requires an SI-Coder user resolved for this directory');
  const overrides = {};
  for (const raw of String(spec).split(',').map(x => x.trim()).filter(Boolean)) {
    const eq = raw.indexOf('=');
    if (eq <= 0 || eq === raw.length - 1) die('--connection expects provider=connection[,provider=connection]');
    const provider = raw.slice(0, eq), connection = raw.slice(eq + 1);
    if (!byId.has(provider)) die(`unknown provider "${provider}" in --connection`);
    let row;
    try { row = C.get(profile, provider, connection); } catch (e) { die(e.message); }
    if ((row.source || 'sc') !== 'sc') {
      die(`sc run can inject only source=sc credentials; ${provider}/${row.label} uses source=${row.source}. Resolve it with sc user connection-request and execute through ${row.source === 'composio' ? 'Composio using its connected account id/alias' : 'the provider-native MCP session'}.`);
    }
    overrides[provider] = connection;
  }
  return overrides;
}

// Run any command with the resolved user + selected provider connections injected. Keeps
// secrets out of the parent shell. --connection mirrors Composio explicit account selection.
function cmdRun(args) {
  const idx = process.argv.indexOf('--');
  const cmd = idx === -1 ? [] : process.argv.slice(idx + 1);
  if (!cmd.length) die('usage: sc run [--connection provider=alias] -- <command> [args...]');
  const resolved = P.resolveProfile();
  const previous = CONNECTION_OVERRIDES;
  CONNECTION_OVERRIDES = parseRunConnectionOverrides(args.connection, resolved.profile);
  invalidateEnvCache();
  try {
    const { env, profile, owner, shadowed, selectedConnections } = currentEnvFull();
    if (profile) {
      console.error(`👤 running as user "${owner || profile}" · profile "${profile}"`);
      const selected = Object.entries(selectedConnections || {}).map(([provider, row]) => `${provider}=${row.label}`);
      if (selected.length) console.error(`   connections: ${selected.join(', ')}`);
      if (shadowed.length) console.error(`   unset for the child: ${shadowed.join(', ')}`);
    }
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env });
    process.exitCode = r.status === null ? 1 : r.status;
  } finally {
    CONNECTION_OVERRIDES = previous;
    invalidateEnvCache();
  }
}

async function cmdUser(sub, arg, arg2, args) {
  switch (sub) {
    case undefined:
    case 'list':  return cmdUserList();
    case 'which': return cmdUserWhich();
    case 'show':  return cmdUserProfileInfo(arg);
    case 'owner': return cmdUserOwner(arg, arg2);
    case 'add':   return cmdUserAdd(arg, args);
    case 'duplicate':
    case 'clone': return cmdUserDuplicate(arg, arg2, args);
    case 'rename': return cmdUserRename(arg, arg2);
    case 'import':
    case 'import-current': return cmdUserImportCurrent(arg, args);
    case 'connections': return cmdUserConnections(arg, arg2);
    case 'connection-add': return cmdUserConnectionAdd(arg, arg2, args._[4], args);
    case 'connection-authorize': return cmdUserConnectionAuthorize(arg, arg2, args._[4], args);
    case 'connection-sync': return cmdUserConnectionSync(arg, arg2, args._[4]);
    case 'connection-metadata-migrate': return cmdConnectionMetadataMigrate(args);
    case 'connection-use': return cmdUserConnectionUse(arg, arg2, args._[4]);
    case 'connection-label': return cmdUserConnectionLabel(arg, arg2, args._[4], args._[5]);
    case 'connection-rm':
    case 'connection-delete': return cmdUserConnectionRm(arg, arg2, args._[4], args);
    case 'connection-migrate': return cmdUserConnectionMigrate(arg, args, arg2 || null);
    case 'credentials': return cmdUserCredentials(arg, arg2, args);
    case 'credential-status': return cmdUserCredentialStatus(arg, arg2, args._[4], args);
    case 'credential-set': return cmdUserCredentialSet(arg, arg2, args._[4], args);
    case 'credential-rm':
    case 'credential-delete': return cmdUserCredentialRm(arg, arg2, args._[4], args);
    case 'verify': return cmdUserVerify(arg, arg2, args);
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
  const full = currentEnvFull();
  const env = full.env;
  const ids = resolveIds(args) || PROVIDERS.filter(p => p.status !== 'stub').map(p => p.id);
  console.log('\n🩺 sc doctor — live verification against each provider API\n');
  profileBanner();
  console.log('');
  let fails = 0, checked = 0;
  const results = await Promise.all(ids.map(async id => {
    const p = byId.get(id);
    const selected = full.selectedConnections?.[id] || null;
    let r;
    if (selected?.source === 'composio') {
      if (!selected.externalRef?.connectedAccountId) {
        r = { ok: false, detail: `${selected.label} · Composio · needs authorization` };
      } else {
        try {
          const synced = await CC.sync(full.profile, id, selected.id);
          r = { ok: synced.status === 'ACTIVE', detail: `${selected.label} · Composio · ${synced.status}` };
        } catch (e) {
          r = { ok: false, detail: `${selected.label} · Composio check failed: ${e.message}` };
        }
      }
    } else if (selected?.source === 'native-mcp') {
      r = { ok: null, detail: `${selected.label} · native MCP auth is verified in the provider-owned MCP session` };
    } else {
      try { r = await p.check(env); } catch (e) { r = { ok: false, detail: `check threw: ${e.message}` }; }
    }
    return { p, r };
  }));
  for (const { p, r } of results) {
    const icon = r.ok === true ? '✅' : r.ok === false ? '❌' : '⚪';
    if (r.ok === false) fails++;
    if (r.ok !== null) checked++;
    console.log(`  ${icon} ${p.id.padEnd(14)} ${r.detail}`);
  }
  console.log(`\n  ${checked} verified live, ${fails} failing, ${results.length - checked} not verifiable here.\n`);
  if (fails) { if (MENU_MODE) return { ok: false, fails, checked }; process.exitCode = 1; }
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
  for (const m of missing) {
    console.log(`   • ${m.key}   (${m.id})`);
    printCredentialGuide(m.key, '     ');
  }
  printRecommendation(recommendation({ next: 'set credential yang masih missing lalu ulangi preflight', why: 'deploy tidak boleh mulai dengan credential yang belum tersedia', needs: missing.map(m => m.key), action: `sc setup --target ${target}` }));

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
    if (MENU_MODE) return;
    process.exit(2);
  }
  die('still missing required credentials', 1);
}



function renderUserPlan(plan) {
  const u = plan.userPlan || {};
  console.log(`\n✨ ${u.title || 'Ready to continue'}`);
  if (u.outcome) console.log(`   ${u.outcome}`);
  if (u.connectionMessage) console.log(`\n   ${u.connectionMessage}`);
  if (u.question) {
    console.log(`\n   ${u.question}`);
    for (const c of u.choices || []) console.log(`   • ${c.label}`);
    return;
  }
  if (Array.isArray(u.steps) && u.steps.length) {
    console.log('\n   What I will handle:');
    u.steps.forEach((step, i) => console.log(`   ${i + 1}. ${step}`));
  }
  if (u.action) {
    console.log(`\n   What you need to do now:`);
    console.log(`   ${u.action.title}`);
    console.log(`   ${u.action.message}`);
    if (u.action.buttonLabel) console.log(`   → ${u.action.buttonLabel}`);
  }
  console.log('\n   I will keep technical details in the background unless you ask for them.');
}

function cmdDeploy(sub, args) {
  if (!sub || sub === 'plan') {
    const plan = planDeploy({
      runtime: args.runtime || (args.hosted ? 'hosted' : args.local ? 'local' : process.env.SC_RUNTIME || 'auto'),
      requestedTarget: args.target || 'auto',
      env: currentEnv(),
      composioAvailable: args.composio === true ? true : args['no-composio'] === true ? false : process.env.SC_COMPOSIO_AVAILABLE,
      vpsAvailable: args.vps === true ? true : args['no-vps'] === true ? false : undefined,
    });
    if (args.json || !process.stdout.isTTY) console.log(JSON.stringify(plan, null, 2));
    else {
      renderUserPlan(plan);
      if (args.technical || args.advanced) {
        console.log(`\n🔧 Technical details`);
        console.log(`   route: ${plan.route}${plan.target ? ` → ${plan.target}` : ''}`);
        console.log(`   reason: ${plan.reason}`);
        console.log(`   flow: ${plan.flow.join(' → ')}`);
        for (const p of plan.providerRouting) console.log(`   ${p.provider.padEnd(10)} ${p.backend}`);
      }
      console.log('');
    }
    return;
  }
  die(`unknown: deploy ${sub}`);
}

// Bare `sc` on a terminal opens a Finder-style alternate-screen console. Navigation
// repaints one stable frame instead of appending prompts to scrollback. The full stack is
// rendered as Finder-like columns and the breadcrumb is always visible as a tab/path bar.
function menuLayer(stack) {
  const ids = stack.map(x => x.id);
  const here = ids.join('/');
  const ctx = menuContext(stack);

  if (here === '') return [
    { id: 'users',    kind: 'branch', label: 'Users', hint: 'each user owns an isolated provider + credential set' },
    { id: 'build',    kind: 'action', label: 'Build / publish', hint: 'plan the simplest suitable route' },
    { id: 'catalog',  kind: 'branch', label: 'Provider catalog', hint: 'available integrations; credentials live under Users' },
    { id: 'system',   kind: 'branch', label: 'System', hint: 'update, history, version, readiness' },
    { id: 'quit',     kind: 'action', label: 'Quit', hint: 'close the SI-Coder menu' },
  ];

  if (here === 'users') {
    const st = ensureScMd();
    const resolved = P.resolveProfile();
    const rows = P.listProfileRecords().map(r => {
      const marks = [];
      if (r.name === st.active) marks.push('default');
      if (r.name === resolved.profile) marks.push('current');
      return {
        id: `user:${r.name}`,
        kind: 'branch',
        label: r.name,
        hint: `${r.keys} credential(s)${marks.length ? ` · ${marks.join(', ')}` : ''}`,
        preview: UC.previewForUser(r.name),
      };
    });
    return [
      ...rows,
      { id: 'add',   kind: 'action', label: 'Add user', hint: 'create an empty isolated credential store' },
      { id: 'which', kind: 'action', label: 'Current folder', hint: 'show which user this folder resolves to' },
      { id: 'list',  kind: 'action', label: 'Overview', hint: 'all users and ownership state' },
    ];
  }

  if (ctx.user && here === `users/user:${ctx.user}`) {
    const userInfo = UC.showUser(ctx.user);
    return [
      { id: 'providers', kind: 'branch', label: 'Providers', hint: `provider connections owned by ${ctx.user}` },
      { id: 'credentials', kind: 'action', label: 'Credential overview', hint: `${userInfo.connectionCount} connection(s) · ${userInfo.credentialCount} field(s), values hidden` },
      { id: 'default', kind: 'action', label: 'Set as default', hint: 'fallback user when no folder mapping matches' },
      { id: 'map', kind: 'action', label: 'Use for current folder', hint: 'map this folder tree to this user' },
      { id: 'duplicate', kind: 'action', label: 'Duplicate user', hint: 'copy all credentials into another independent user' },
      { id: 'rename', kind: 'action', label: 'Rename user', hint: 'rename identity and migrate default/folder mappings' },
      { id: 'import', kind: 'action', label: 'Import current credentials', hint: 'copy known legacy shell credentials into this user' },
      { id: 'details', kind: 'action', label: 'Details', hint: 'provider summary, mappings, key names; values hidden' },
      { id: 'remove', kind: 'action', label: 'Delete user', hint: 'remove this user and its credential store' },
    ];
  }

  if (ctx.user && here === `users/user:${ctx.user}/providers`) {
    return providerItemsForUser(ctx.user).map(p => ({ id: `provider:${p.id}`, kind: 'branch', pathLabel: p.id, label: p.label, hint: p.hint, preview: p.preview }));
  }

  if (ctx.user && ctx.provider && here === `users/user:${ctx.user}/providers/provider:${ctx.provider}`) {
    const p = byId.get(ctx.provider);
    const connections = C.list(ctx.user, ctx.provider);
    const legacy = P.readProfile(ctx.user);
    const legacyCount = p.vars.filter(v => legacy[v.key] !== undefined).length;
    return [
      { id: 'connections', kind: 'branch', label: 'Connections', hint: `${connections.length} named connection(s) · labels + scopes`, preview: UC.previewForProvider(ctx.user, ctx.provider) },
      { id: 'add-connection', kind: 'branch', label: 'Add connection', hint: `choose where ${ctx.provider} authentication is managed`, preview: [`user ${ctx.user} › ${ctx.provider}`, ...C.sourceOptions(p).map(src => `${src.label} · ${src.description || src.id}`)] },
      ...(legacyCount ? [{ id: 'migrate-legacy', kind: 'action', label: 'Migrate legacy credentials', hint: `${legacyCount} legacy field(s) → named default connection`, preview: [`user ${ctx.user} › ${ctx.provider}`, `${legacyCount} legacy field(s) are still stored in the old profile`, 'migration moves values locally without printing them'] }] : []),
      { id: 'details', kind: 'action', label: 'Provider details', hint: `auth methods + integration metadata for ${ctx.provider}` },
      ...(connections.length || legacyCount ? [{ id: 'verify', kind: 'action', label: 'Verify default connection', hint: `live API check using only ${ctx.user}'s selected ${ctx.provider} connection` }] : []),
    ];
  }

  if (ctx.user && ctx.provider && here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections`) {
    const rows = connectionItemsForUser(ctx.user, ctx.provider);
    return [
      ...rows,
      { id: 'add-connection', kind: 'branch', label: 'Add connection', hint: 'choose source/backend, then authentication' },
    ];
  }

  if (ctx.user && ctx.provider && (here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/add-connection` || here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections/add-connection`)) {
    const p = byId.get(ctx.provider);
    return C.sourceOptions(p).map(source => ({
      id: `source:${source.id}`, kind: 'branch', pathLabel: source.label, label: source.label,
      hint: source.description || source.id,
      preview: [
        `${ctx.provider} › ${source.label}`,
        source.description || `connection source: ${source.id}`,
        source.toolkit ? `toolkit: ${source.toolkit}` : source.id === 'sc' ? 'credentials stay in SI-Coder local 0600 storage' : '',
        source.reference ? `reference: ${source.reference}` : '',
      ].filter(Boolean),
    }));
  }

  if (ctx.user && ctx.provider && ctx.source && (here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/add-connection/source:${ctx.source}` || here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections/add-connection/source:${ctx.source}`)) {
    const p = byId.get(ctx.provider);
    const source = C.sourceOption(p, ctx.source);
    return C.authOptions(p, ctx.source).map(a => {
      const firstField = (a.requiredFields || a.fields || [])[0] || null;
      const guide = firstField ? credentialGuide(firstField, { user: ctx.user, override: a.guidance?.[firstField] || null }) : null;
      return {
        id: `auth:${a.id}`, kind: 'action', pathLabel: a.label, label: a.label,
        hint: `${a.scheme} · scope ${a.scope}${a.recommended ? ` · ${a.recommended}` : ''}`,
        preview: [
          `${ctx.provider} › ${source.label} › ${a.label}`,
          `${a.scheme} · scope: ${a.scope}${a.fields?.length ? ` · fields: ${a.fields.join(', ')}` : ''}`,
          ctx.source === 'sc' ? (guide?.referenceUrl ? `open: ${guide.referenceUrl}` : guide?.createCommand ? `get with: ${guide.createCommand}` : 'direct connection · setup shown per credential field') : 'external account · provider credential is not stored in SI-Coder',
          ctx.source === 'sc' ? (guide?.navigationText ? `click: ${guide.navigationText}` : '') : source.reference ? `reference: ${source.reference}` : '',
        ].filter(Boolean),
      };
    });
  }

  if (ctx.user && ctx.provider && ctx.connection && here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections/connection:${ctx.connection}`) {
    const c = UC.connectionStatus(ctx.user, ctx.provider, ctx.connection);
    const items = [
      ...(!c.external && c.total ? [{ id: 'credentials', kind: 'branch', label: 'Credentials', hint: `${c.total} field(s) in ${c.label}`, preview: UC.previewForConnection(ctx.user, ctx.provider, ctx.connection) }] : []),
      { id: 'auth-guide', kind: 'action', label: c.external ? 'Authorization guide' : 'Auth / setup guide', hint: `${c.sourceLabel} · ${c.scheme} · ${c.scope}`, preview: UC.previewForConnection(ctx.user, ctx.provider, ctx.connection) },
      ...(c.source === 'composio' && !c.externalRef?.connectedAccountId ? [{ id: 'connect-external', kind: 'action', label: 'Connect account', hint: 'create a secure Composio Connect Link', preview: UC.previewForConnection(ctx.user, ctx.provider, ctx.connection) }] : []),
      ...(c.source === 'composio' && c.externalRef?.connectedAccountId ? [{ id: 'sync-external', kind: 'action', label: 'Refresh status', hint: 'read safe Connected Account status; credentials are discarded', preview: UC.previewForConnection(ctx.user, ctx.provider, ctx.connection) }] : []),
      ...(!c.isDefault ? [{ id: 'default-connection', kind: 'action', label: 'Set as default', hint: `use ${c.label} when ${ctx.provider} has no explicit connection override`, preview: UC.previewForConnection(ctx.user, ctx.provider, ctx.connection) }] : []),
      { id: 'label-connection', kind: 'action', label: 'Rename label', hint: `current label: ${c.label}` },
      ...(!c.external ? [{ id: 'verify-connection', kind: 'action', label: 'Verify this connection', hint: 'live API check with only this connection injected' }] : []),
      { id: 'delete-connection', kind: 'action', label: 'Delete connection', hint: `remove ${c.label} and its ${c.stored} stored field(s)` },
    ];
    return items;
  }

  if (ctx.user && ctx.provider && ctx.connection && here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections/connection:${ctx.connection}/credentials`) {
    return credentialItemsForUser(ctx.user, ctx.provider, ctx.connection);
  }

  if (ctx.user && ctx.provider && ctx.connection && ctx.credential && here === `users/user:${ctx.user}/providers/provider:${ctx.provider}/connections/connection:${ctx.connection}/credentials/credential:${ctx.credential}`) {
    const c = UC.credentialStatus(ctx.user, ctx.provider, ctx.credential, ctx.connection);
    const guidePreview = UC.previewForCredential(ctx.user, ctx.provider, ctx.credential, ctx.connection);
    return [
      { id: 'status', kind: 'action', label: 'Status', hint: `show ${c.connectionLabel}/${ctx.credential}; plaintext disabled`, preview: guidePreview },
      { id: 'set', kind: 'action', label: c.stored ? 'Rotate credential' : 'Set credential', hint: `hidden input stored only under ${ctx.user} / ${c.connectionLabel}`, preview: guidePreview },
      ...(c.stored ? [{ id: 'remove', kind: 'action', label: 'Remove credential', hint: `delete only ${ctx.credential} from ${c.connectionLabel}`, preview: guidePreview }] : []),
    ];
  }

  if (here === 'catalog') {
    return PROVIDERS.map(p => ({ id: `provider:${p.id}`, kind: 'branch', pathLabel: p.id, label: p.id, hint: p.blurb, preview: [`provider ${p.id} — ${p.title}`, p.blurb, `${p.vars.length} credential field(s) · choose a User to manage values`] }));
  }
  if (ctx.provider && here === `catalog/provider:${ctx.provider}`) return [
    { id: 'details', kind: 'action', label: 'Provider definition', hint: 'metadata/setup requirements only; choose a User to manage credentials' },
  ];

  if (here === 'system') return [
    { id: 'version',   kind: 'action', label: 'Version', hint: 'version and source checkout' },
    { id: 'update',    kind: 'action', label: 'Update SI-Coder', hint: 'safe fast-forward update' },
    { id: 'audit',     kind: 'action', label: 'History', hint: 'metadata-only configuration activity' },
    { id: 'readiness', kind: 'branch', label: 'Readiness check', hint: 'preflight by deployment target' },
  ];

  if (here === 'system/readiness') return Object.entries(TARGET_PROVIDERS).map(([target, ids]) => ({
    id: `target:${target}`, kind: 'action', label: target, hint: `needs: ${ids.join(', ')}`,
  }));

  return [];
}

function menuContext(stack) {
  const userNode = [...stack].reverse().find(x => x.id.startsWith('user:'));
  const providerNode = [...stack].reverse().find(x => x.id.startsWith('provider:'));
  const sourceNode = [...stack].reverse().find(x => x.id.startsWith('source:'));
  const connectionNode = [...stack].reverse().find(x => x.id.startsWith('connection:'));
  const credentialNode = [...stack].reverse().find(x => x.id.startsWith('credential:'));
  return {
    user: userNode ? userNode.id.slice('user:'.length) : null,
    provider: providerNode ? providerNode.id.slice('provider:'.length) : null,
    source: sourceNode ? sourceNode.id.slice('source:'.length) : null,
    connection: connectionNode ? connectionNode.id.slice('connection:'.length) : null,
    credential: credentialNode ? credentialNode.id.slice('credential:'.length) : null,
  };
}

function menuColumns(stack) {
  const columns = [];
  for (let depth = 0; depth <= stack.length; depth++) {
    const prefix = stack.slice(0, depth);
    const items = menuLayer(prefix);
    columns.push({
      title: depth === 0 ? 'SI-Coder' : stack[depth - 1].label,
      nodeId: depth === 0 ? 'root' : stack[depth - 1].id,
      items,
      selectedId: depth < stack.length ? stack[depth].id : null,
    });
  }
  return columns;
}

const MENU_SECTIONS = [
  { id: 'users', label: 'Users' },
  { id: 'build', label: 'Build' },
  { id: 'catalog', label: 'Providers' },
  { id: 'system', label: 'System' },
];

async function runMenuAction(stack, item) {
  const ids = stack.map(x => x.id);
  const here = ids.join('/');
  const { user, provider, source, connection, credential } = menuContext(stack);
  try {
    if (here === '' && item.id === 'build') return cmdDeploy('plan', {});
    if (here === '' && item.id === 'quit') return 'quit';

    if (here === 'users') {
      if (item.id === 'which') return cmdUserWhich();
      if (item.id === 'add') return cmdUserAdd(undefined, {});
      if (item.id === 'list') return cmdUserList();
    }

    if (user && here === `users/user:${user}`) {
      if (item.id === 'credentials') return cmdUserCredentials(user);
      if (item.id === 'default') return cmdUserUse(user);
      if (item.id === 'map') return cmdUserMap('.', user);
      if (item.id === 'duplicate') return cmdUserDuplicate(user, undefined, {});
      if (item.id === 'rename') {
        const renamed = await cmdUserRename(user);
        return renamed ? { renameUser: renamed } : undefined;
      }
      if (item.id === 'import') return cmdUserImportCurrent(user, {});
      if (item.id === 'details') return cmdUserProfileInfo(user);
      if (item.id === 'remove') {
        await cmdUserRm(user, {});
        return P.profileExists(user) ? undefined : 'back';
      }
    }

    if (user && provider && here === `users/user:${user}/providers/provider:${provider}`) {
      if (item.id === 'migrate-legacy') return cmdUserConnectionMigrate(user, {}, provider);
      if (item.id === 'details') return cmdProviderDefinition(provider);
      if (item.id === 'verify') return cmdUserVerify(user, provider, {});
    }


    if (user && provider && source && (here === `users/user:${user}/providers/provider:${provider}/add-connection/source:${source}` || here === `users/user:${user}/providers/provider:${provider}/connections/add-connection/source:${source}`) && item.id.startsWith('auth:')) {
      return cmdUserConnectionAdd(user, provider, undefined, { source, auth: item.id.slice('auth:'.length) });
    }

    if (user && provider && connection && here === `users/user:${user}/providers/provider:${provider}/connections/connection:${connection}`) {
      if (item.id === 'auth-guide') return cmdUserConnectionGuide(user, provider, connection);
      if (item.id === 'connect-external') return cmdUserConnectionAuthorize(user, provider, connection, {});
      if (item.id === 'sync-external') return cmdUserConnectionSync(user, provider, connection);
      if (item.id === 'default-connection') return cmdUserConnectionUse(user, provider, connection);
      if (item.id === 'label-connection') return cmdUserConnectionLabel(user, provider, connection);
      if (item.id === 'verify-connection') return cmdUserVerify(user, provider, { connection });
      if (item.id === 'delete-connection') return cmdUserConnectionRm(user, provider, connection, {});
    }

    if (user && provider && connection && credential && here === `users/user:${user}/providers/provider:${provider}/connections/connection:${connection}/credentials/credential:${credential}`) {
      if (item.id === 'status') return cmdUserCredentialStatus(user, provider, credential, { connection });
      if (item.id === 'set') return cmdUserCredentialSet(user, provider, credential, { connection });
      if (item.id === 'remove') return cmdUserCredentialRm(user, provider, credential, { connection });
    }

    if (provider && here === `catalog/provider:${provider}` && item.id === 'details') {
      return cmdProviderDefinition(provider);
    }

    if (here === 'system') {
      if (item.id === 'version') return cmdVersion({});
      if (item.id === 'update') return cmdUpdate({});
      if (item.id === 'audit') return cmdAudit({});
    }
    if (here === 'system/readiness' && item.id.startsWith('target:')) {
      return cmdPreflight({ target: item.id.slice('target:'.length) });
    }
  } catch (e) {
    if (e?.menuCommand) {
      console.error(`\n❌ ${e.message}\n`);
      return;
    }
    throw e;
  } finally {
    invalidateEnvCache();
  }
}

function menuActionNeedsTerminal(stack, item) {
  const here = stack.map(x => x.id).join('/');
  const { user, provider, source, connection, credential } = menuContext(stack);
  if (here === 'users' && item.id === 'add') return true;
  if (user && here === `users/user:${user}` && ['duplicate', 'rename', 'import', 'remove'].includes(item.id)) return true;
  if (user && provider && here === `users/user:${user}/providers/provider:${provider}` && item.id === 'migrate-legacy') return true;
  if (user && provider && source && (here === `users/user:${user}/providers/provider:${provider}/add-connection/source:${source}` || here === `users/user:${user}/providers/provider:${provider}/connections/add-connection/source:${source}`) && item.id.startsWith('auth:')) return true;
  if (user && provider && connection && here === `users/user:${user}/providers/provider:${provider}/connections/connection:${connection}` && ['connect-external', 'label-connection', 'delete-connection'].includes(item.id)) return true;
  if (user && provider && connection && credential && here === `users/user:${user}/providers/provider:${provider}/connections/connection:${connection}/credentials/credential:${credential}` && ['set', 'remove'].includes(item.id)) return true;
  if (here === 'system/readiness') return true;
  return false;
}

async function captureConsole(fn) {
  const lines = [];
  const methods = ['log', 'error', 'warn', 'info'];
  const original = Object.fromEntries(methods.map(k => [k, console[k]]));
  const capture = (...args) => {
    const text = args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' ');
    for (const line of text.split(/\r?\n/)) if (line.trim()) lines.push(stripAnsi(line));
  };
  methods.forEach(k => { console[k] = capture; });
  try {
    return { value: await fn(), lines };
  } finally {
    methods.forEach(k => { console[k] = original[k]; });
  }
}

async function runTerminalMenuAction(stack, item) {
  clearAlternateScreen(process.stdout, { cursor: true });
  console.log(`SI-Coder › ${[...stack.map(x => x.label), stripAnsi(item.label)].join(' › ')}\n`);
  const value = await runMenuAction(stack, item);
  if (value !== 'quit') await waitForEnter('Press Enter to return to SI-Coder ');
  hideCursor();
  return value;
}

async function cmdMenu() {
  if (!isInteractive()) die('sc menu needs a TTY');
  MENU_MODE = true;
  const stack = [];
  const selectedByLayer = new Map();
  const queryByLayer = new Map();
  let activity = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    leaveAlternateScreen();
  };
  process.once('exit', cleanup);
  enterAlternateScreen();

  try {
    while (true) {
      const here = stack.map(x => x.id).join('/');
      const items = menuLayer(stack);
      const breadcrumb = ['SI-Coder', ...stack.map(x => x.label)];
      const columns = menuColumns(stack);
      const result = await selectFinderFrame({
        title: 'SI-Coder — build and publish a web app',
        breadcrumb,
        stack,
        columns,
        sections: MENU_SECTIONS,
        initialId: selectedByLayer.get(here) || null,
        initialQuery: queryByLayer.get(here) || '',
        activity,
        canBack: stack.length > 0,
      });
      if (result.selectedId) selectedByLayer.set(here, result.selectedId);
      queryByLayer.set(here, result.query || '');

      if (!result || result.type === 'quit') break;
      if (result.type === 'noop') continue;
      if (result.type === 'back') {
        activity = [];
        if (stack.length) stack.pop();
        continue; // Esc/Left at Home intentionally does not close the CLI.
      }
      const item = items.find(x => x.id === result.id);
      if (!item) continue;
      if (result.type === 'open' && item.kind === 'branch') {
        activity = [];
        stack.push({ id: item.id, label: stripAnsi(item.pathLabel || item.label).trim() });
        continue;
      }

      let actionResult;
      if (menuActionNeedsTerminal(stack, item)) {
        actionResult = await runTerminalMenuAction(stack, item);
        activity = [`${stripAnsi(item.label)} completed`];
      } else {
        const captured = await captureConsole(() => runMenuAction(stack, item));
        actionResult = captured.value;
        activity = captured.lines.length ? captured.lines : [`${stripAnsi(item.label)} completed`];
      }
      if (actionResult === 'quit') break;
      if (actionResult === 'back' && stack.length) stack.pop();
      if (actionResult && typeof actionResult === 'object' && actionResult.renameUser) {
        const index = stack.findIndex(x => x.id.startsWith('user:'));
        if (index >= 0) {
          const renamed = actionResult.renameUser;
          stack[index] = { id: `user:${renamed}`, label: renamed };
          stack.splice(index + 1);
          activity = [`User renamed to ${renamed}`, 'Default and folder mappings were migrated'];
        }
      }
      // The Finder frame is repainted in-place after every action; sc remains open.
    }
  } finally {
    MENU_MODE = false;
    invalidateEnvCache();
    process.removeListener('exit', cleanup);
    cleanup();
  }
}

// ---------------------------------------------------------------------------
function usage() {
  console.log(`
sc — SI-Coder interactive console + secret control plane

  bare \`sc\` on a TTY opens a Finder-style alternate-screen TUI:
      one stable frame · visible SECTIONS tabs + PATH breadcrumb · Finder columns
      ↑/↓ move · Tab/→ deeper · Enter open/run · ←/Esc back · Ctrl-D quit
      navigation does not append lines to terminal scrollback
      actions return to the same TUI frame instead of closing the CLI

  sc update [--check] [--json]        safe self-update: fetch + fast-forward only
  sc version [--json]                 version, source checkout and git state
  sc deploy plan [--runtime auto|hosted|local] [--target auto|vps|managed|dokploy|hybrid|vercel]
                 [--vps|--no-vps] [--composio|--no-composio] [--json]
                                      branch runtime first; hosted = full Composio, local asks/detects VPS first

  sc providers [--json]               list built-in + custom providers; never secret values
  sc providers show <id>              provider detail (secret values redacted)
  sc providers create <id> --key KEY --url https://... [--navigation "Settings > API Keys > Create"] [--title ...]
                                      create a custom provider definition (metadata only)
  sc providers update <id> [--title ...] [--blurb ...]
  sc providers key-add <id> <KEY> [--required] [--public] [--navigation "A > B > C"] [--prefix P]
  sc providers key-rm <id> <KEY> [--yes]
  sc providers delete <id> [--yes]    custom only; also purges its managed credentials

  sc secret list [provider] [--json]  credential state/source only; NO plaintext
  sc secret get <provider> [KEY]      safe read: state/source; plaintext read is disabled
  sc secret set <provider> [KEY]      hidden TTY entry; with KEY also supports:
      --stdin | --from-env NAME | --from-file PATH
                                      secret never belongs in argv/chat
  sc secret rm <provider> [KEY] [--yes]
  sc run [--connection provider=alias[,provider=alias]] -- <cmd> ...
                                      consume one user's selected named connections without changing defaults

  sc setup [--providers a,b] [--target t] [--force]
                                      interactive setup wizard
  sc doctor [--providers a,b] [--target t]
                                      LIVE provider verification
  sc preflight --target <dokploy|hybrid|vercel>
                                      gate used by /sc-all
  sc audit [--limit N] [--json]       metadata-only lifecycle audit trail

  sc user                             list users + credential counts + current resolution
  sc user which                       why this directory resolves to that user
  sc user show <name>                 provider/key ownership summary; values hidden
  sc user add <name> [--from-shell]   create an isolated user credential store
  sc user import <name> [--yes]       import missing known credentials from legacy shell
  sc user duplicate <src> <dst> [--replace-empty]
                                      clone credentials into an independent user
  sc user rename <src> <dst>          rename user + migrate default/folder mappings
  sc user connections <name> [provider]
                                      list labeled connections + auth/scope; no plaintext
  sc user connection-add <name> <provider> <label> --source <sc|composio|native-mcp> --auth <method> [--default]
  sc user connection-authorize <name> <provider> <connection> [--auth-config ID] [--composio-connection ID]
                                      create a transient Composio Connect Link; persists only external ids/status
  sc user connection-sync <name> <provider> <connection>
                                      refresh safe connected-account status from Composio
  sc user connection-metadata-migrate --yes
                                      persist v1→v2 source/backend metadata with a 0600 backup
  sc user connection-use <name> <provider> <connection>
  sc user connection-label <name> <provider> <connection> <label>
  sc user connection-rm <name> <provider> <connection> [--yes]
  sc user connection-migrate <name> [provider] [--yes]
                                      move legacy fields into named default connections
  sc user credentials <name> [provider] [--connection alias]
                                      read credential status for one user/connection; no plaintext
  sc user credential-status <name> <provider> <KEY> [--connection alias]
  sc user credential-set <name> <provider> [KEY] [--connection alias]
                                      create/update through hidden TTY or safe input source
  sc user credential-rm <name> <provider> [KEY] [--connection alias] [--yes]
                                      delete only that user's selected connection credential(s)
  sc user use <name>                  set default user
  sc user map <folder> <name>         bind folder tree to a user
  sc user unmap <folder>              drop mapping
  sc user rm <name> [--yes]           delete user + its credentials
  sc env                              disabled (plaintext export); use sc run

Agent safety contract:
  • agents may LIST/CREATE/UPDATE/DELETE users, named connections, provider metadata, and credential status
  • agents must NEVER ask for or pass a plaintext API key in chat/tool JSON/argv
  • new/rotated secrets enter through hidden TTY, a trusted stdin/FD, env, or local file
  • use sc run [--connection provider=alias] -- <cmd> so consumers receive the intended connection without printing secrets

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
    case 'deploy':    return cmdDeploy(sub, args);
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
