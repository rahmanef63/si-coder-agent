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
const path = require('path');
const {
  PROVIDERS, TARGET_PROVIDERS, VALIDATORS, DOMAIN_VARS,
} = require(path.resolve(__dirname, '../lib/providers'));
const { isSecret, sourceLine, readShellRcEnv } =
  require(path.resolve(__dirname, '../skills/sc-onboarding/lib/onboarding-domains'));
const { appendExportToShellRc, removeExportsFromShellRc, scanProcessEnv, shSingleQuote } =
  require(path.resolve(__dirname, '../lib/env'));
const { spawnSync } = require('child_process');
const { askVisible, askHidden, redactValue, isInteractive, confirm, selectOne, selectMany } =
  require(path.resolve(__dirname, '../lib/prompt'));
const P = require(path.resolve(__dirname, '../lib/profiles'));

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
  if (profile && P.readProfile(profile)[key]) return `profile:${profile}`;
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

function cmdProvidersList(args) {
  const env = currentEnv();
  const ids = resolveIds(args) || PROVIDERS.map(p => p.id);
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
    if (env[v.key]) console.log(`       value : ${isSecret(v.key) ? redactValue(env[v.key]) : env[v.key]}   [from ${sourceOf(v.key)}]`);
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
    console.log(`    ✅ got ${v.key} (${redactValue(value)})`);
    return value;
  }
}

async function collect(ids, { force = false } = {}) {
  const env = currentEnv();
  const updates = {};
  for (const id of ids) {
    const p = byId.get(id);
    if (!p) { console.log(`⚠️ unknown provider "${id}", skip`); continue; }
    const todo = p.vars.filter(v => force || !env[v.key]);
    if (todo.length === 0) { console.log(`  ✅ ${p.id}: already complete`); continue; }
    console.log(`\n── ${p.id.toUpperCase()} — ${p.title} ──`);
    console.log(`   ${p.blurb}`);
    if (p.status === 'stub') console.log('   ⚠️ this /sc-* script is not implemented yet; values are stored for later.');
    for (const v of todo) {
      if (!force && env[v.key]) continue;
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
    console.log('   Run `sc env` (or `sc run -- <cmd>`) to use them outside sc.');
    return;
  }
  if (t.kind === 'profile-unset') {
    die('profiles exist but none governs this directory — pick one with `sc user use <name>` or map it with `sc user map . <name>`');
  }
  appendExportToShellRc(updates);
  console.log(`\n✅ Wrote ${Object.keys(updates).length} export(s) to ~/.bashrc`);
  console.log('   Next: source ~/.bashrc');
}

async function cmdSetup(args) {
  if (!isInteractive()) die('sc setup needs a TTY. Non-interactive? Use:\n   printf \'KEY=VALUE\\n\' | node skills/sc-onboarding/scripts/scan-env.js --write-stdin');
  console.log('\n🚀 si-coder setup\n');
  let ids = resolveIds(args);
  if (!ids) {
    const items = providerItems();
    // Pre-tick whatever is actually incomplete: the common case is "fix what is broken",
    // and starting from an empty list would make the user re-derive that by hand.
    const pre = items.filter(i => i.needsAttention).map(i => i.id);
    ids = await selectMany('Which providers do you want to set up?', items, pre, PROVIDER_TABS);
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

// `eval "$(sc env)"` — the bridge for anything that reads process.env and is not launched
// through `sc run`.
function cmdEnv(args) {
  const { own, profile, shadowed } = currentEnvFull();
  if (!profile) { console.error('# no profile governs this directory — nothing to export'); process.exit(1); }
  const keys = Object.keys(own).sort();
  console.error(`# profile: ${profile} — ${keys.length} value(s)`);
  for (const k of keys) console.log(`export ${k}=${shSingleQuote(own[k])}`);
  // Anything the shell still carries from another identity is actively unset, not just
  // left unexported — otherwise `eval "$(sc env)"` would leave it in place and in effect.
  for (const k of shadowed) console.log(`unset ${k}`);
  if (shadowed.length) console.error(`# unset ${shadowed.length} var(s) not owned by this profile: ${shadowed.join(', ')}`);
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
  const action = await selectOne('sc — si-coder provider console', [
    { id: 'providers', label: 'providers', hint: 'see what is configured' },
    { id: 'setup',     label: 'setup    ', hint: 'fill in what is missing' },
    { id: 'doctor',    label: 'doctor   ', hint: 'live check against each real API' },
    { id: 'show',      label: 'show     ', hint: 'detail for one provider' },
    { id: 'set',       label: 'set      ', hint: 'rotate one provider\'s credentials' },
    { id: 'rm',        label: 'rm       ', hint: "remove one provider's vars from ~/.bashrc" },
    { id: 'preflight', label: 'preflight', hint: 'check a /sc-all deploy target' },
    { id: 'users',     label: 'users    ', hint: 'profiles, and which folder uses which' },
    { id: 'which',     label: 'which    ', hint: 'why this directory resolves to that profile' },
    { id: 'quit',      label: 'quit     ', hint: '' },
  ]);
  switch (action) {
    case 'providers': return cmdProvidersList({});
    case 'setup':     return cmdSetup({});
    case 'doctor':    return cmdDoctor({});
    case 'show':      return cmdProvidersShow(undefined);
    case 'set':       return cmdProvidersSet(undefined);
    case 'rm':        return cmdProvidersRm(undefined, {});
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
sc — si-coder provider console

  sc providers                      list every provider and what is configured
  sc providers show <id>            per-var detail for one provider
  sc providers set  <id>            re-enter (rotate) every var for one provider
  sc providers rm   <id> [--yes]    remove its vars from the ~/.bashrc managed block
  sc setup [--providers a,b] [--target t] [--force]
                                    interactive wizard for whatever is missing
  sc doctor [--providers a,b] [--target t]
                                    LIVE check: call each real API, report what works
  sc preflight --target <dokploy|hybrid|vercel>
                                    gate used by /sc-all

  sc user                           list profiles + which one governs this directory
  sc user which                     why this directory resolves to that profile
  sc user add <name> [--from-shell] create a profile (optionally import the current env)
  sc user use <name>                set the fallback (active) profile
  sc user map <folder> <name>       bind a folder (and its children) to a profile
  sc user unmap <folder>            drop that rule
  sc user rm <name> [--yes]         delete a profile and its stored credentials
  sc user edit                      print the path to sc.md
  sc env                            print export lines: eval "$(sc env)"
  sc run -- <cmd> ...               run a command with the resolved profile injected

  --no-profile                      ignore profiles for this one command

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
      if (sub === 'set') return cmdProvidersSet(arg);
      if (sub === 'rm') return cmdProvidersRm(arg, args);
      return die(`unknown: providers ${sub}`);
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
