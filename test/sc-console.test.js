// sc-console.test.js — the provider registry is now DERIVED, and `sc` is what users drive.
// These lock the two properties that made the old hand-maintained registry go wrong
// (drift between the parallel maps) and the one that makes auto-launch safe (never
// prompt without a TTY, because that hangs CI instead of asking).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  PROVIDERS, TARGET_PROVIDERS, DOMAIN_VARS, VALIDATORS, SECRET_SOURCES,
} = require(path.join(ROOT, 'lib/providers'));
const { removeExportsFromShellRc, appendExportToShellRc } = require(path.join(ROOT, 'lib/env'));

const allVars = PROVIDERS.flatMap(p => p.vars);

test('SCP-1: every provider has an id, a blurb and at least one var', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.blurb, `provider ${p.id} incomplete`);
    assert.ok(Array.isArray(p.vars) && p.vars.length > 0, `${p.id} has no vars`);
  }
});

test('SCP-2: every provider exposes an async check() that never throws on empty env', async () => {
  for (const p of PROVIDERS) {
    assert.strictEqual(typeof p.check, 'function', `${p.id} has no check()`);
    const r = await p.check({});
    assert.ok(r && 'ok' in r && 'detail' in r, `${p.id}.check({}) returned ${JSON.stringify(r)}`);
    // ok===null means "not verifiable", which is the correct answer for an unset credential.
    assert.ok(r.ok === true || r.ok === false || r.ok === null, `${p.id}.check ok must be tri-state`);
  }
});

test('SCP-3: DOMAIN_VARS is derived exactly from the registry (no drift possible)', () => {
  for (const p of PROVIDERS) {
    const d = DOMAIN_VARS[p.id];
    assert.deepStrictEqual(d.required, p.vars.filter(v => v.required).map(v => v.key));
    assert.deepStrictEqual(d.optional, p.vars.filter(v => !v.required).map(v => v.key));
  }
  assert.strictEqual(Object.keys(DOMAIN_VARS).length, PROVIDERS.length);
});

test('SCP-4: every var carries a validator and a source (the old registry drifted on both)', () => {
  for (const v of allVars) {
    assert.strictEqual(typeof v.validate, 'function', `${v.key} has no validator`);
    assert.ok(SECRET_SOURCES[v.key], `${v.key} has no source entry`);
    const s = SECRET_SOURCES[v.key];
    assert.ok(s.url || s.cmd || s.note, `${v.key} names neither url, cmd nor note`);
    assert.strictEqual(VALIDATORS[v.key], v.validate, `${v.key} validator not exported`);
  }
});

test('SCP-5: no duplicate var key across providers', () => {
  const seen = new Map();
  for (const p of PROVIDERS) for (const v of p.vars) {
    assert.ok(!seen.has(v.key), `${v.key} declared by both ${seen.get(v.key)} and ${p.id}`);
    seen.set(v.key, p.id);
  }
});

test('SCP-6: every TARGET_PROVIDERS entry names real providers', () => {
  const ids = new Set(PROVIDERS.map(p => p.id));
  for (const [target, list] of Object.entries(TARGET_PROVIDERS)) {
    for (const id of list) assert.ok(ids.has(id), `target ${target} names unknown provider ${id}`);
  }
});

test('SCP-7: validators accept the documented real shapes and reject junk', () => {
  assert.ok(VALIDATORS.DOKPLOY_API_URL('http://127.0.0.1:3000/api'),
    'the standard local panel URL must validate — it is http and it is what every box uses');
  assert.ok(VALIDATORS.DOKPLOY_API_URL('https://panel.example.com/api'));
  assert.ok(!VALIDATORS.DOKPLOY_API_URL('https://panel.example.com'), 'missing /api must fail');
  assert.ok(VALIDATORS.DOKPLOY_PUBLIC_IP('187.52.119.3'));
  assert.ok(!VALIDATORS.DOKPLOY_PUBLIC_IP('panel.example.com'));
  assert.ok(VALIDATORS.CLOUDFLARE_ZONE_ID('3cf2da42288b236db31d5b568121887f'));
  assert.ok(!VALIDATORS.CLOUDFLARE_ZONE_ID('not-a-zone-id'));
});

test('SCE-1: removeExportsFromShellRc strips managed keys and leaves the block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrc-'));
  const rc = path.join(dir, '.bashrc');
  fs.writeFileSync(rc, 'echo hi\n');
  appendExportToShellRc({ FOO_TOKEN: 'a', BAR_TOKEN: 'b' }, rc);
  const { removed } = removeExportsFromShellRc(['FOO_TOKEN'], rc);
  const after = fs.readFileSync(rc, 'utf8');
  assert.deepStrictEqual(removed, ['FOO_TOKEN']);
  assert.ok(!after.includes('FOO_TOKEN'), 'removed key still present');
  assert.ok(after.includes('BAR_TOKEN'), 'sibling key was collateral damage');
  assert.ok(after.includes('echo hi'), 'user content outside the block was destroyed');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCE-2: an export OUTSIDE the managed block is reported, never silently deleted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrc-'));
  const rc = path.join(dir, '.bashrc');
  fs.writeFileSync(rc, "export USER_OWNED='mine'\n");
  const { removed, unmanaged } = removeExportsFromShellRc(['USER_OWNED'], rc);
  assert.deepStrictEqual(removed, []);
  assert.deepStrictEqual(unmanaged, ['USER_OWNED']);
  assert.ok(fs.readFileSync(rc, 'utf8').includes("export USER_OWNED='mine'"),
    'a user-owned export must survive');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCC-1: preflight refuses to prompt without a TTY (a hang is not a question)', () => {
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'preflight', '--target', 'dokploy'],
      { input: '', encoding: 'utf8', timeout: 20000, env: { ...process.env, GITHUB_TOKEN: '' } });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status; }
  if (code !== 0) {
    assert.match(out, /Not a TTY/, 'must say why it refused');
    assert.strictEqual(code, 1);
  } else {
    assert.match(out, /preflight ok/, 'a zero exit must mean everything required was present');
  }
});

test('SCC-2: setup refuses without a TTY and names the non-interactive path', () => {
  let out = '', code = 0;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'setup', '--target', 'dokploy'],
      { input: '', encoding: 'utf8', timeout: 20000 });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status; }
  assert.strictEqual(code, 1);
  assert.match(out, /needs a TTY/);
  assert.match(out, /--write-stdin/, 'must point at the scriptable path');
});

test('SCC-3: unknown target and unknown provider are rejected, not guessed', () => {
  for (const args of [['preflight', '--target', 'nope'], ['providers', 'show', 'nope']]) {
    let code = 0;
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), ...args],
        { input: '', encoding: 'utf8', timeout: 20000, stdio: 'pipe' });
    } catch (e) { code = e.status; }
    assert.strictEqual(code, 1, `${args.join(' ')} should exit 1`);
  }
});

test('SCC-4: bare `sc` stays scriptable — usage on a pipe, never a menu', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js')],
    { input: '', encoding: 'utf8', timeout: 20000 });
  assert.match(out, /si-coder provider console/);
  assert.match(out, /sc preflight --target/, 'usage must still list the commands');
  assert.doesNotMatch(out, /\u001b\[\?25l/, 'must not emit cursor-hiding escapes to a pipe');
});

test('SCC-5: an id-less providers subcommand fails loudly off a TTY instead of waiting', () => {
  let out = '', code = 0;
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'providers', 'show'],
      { input: '', encoding: 'utf8', timeout: 20000 });
  } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status; }
  assert.strictEqual(code, 1);
  assert.match(out, /non-TTY/);
});

test('SCC-6: the pickers are exported and take the documented shape', () => {
  const { selectOne, selectMany } = require(path.join(ROOT, 'lib/prompt'));
  assert.strictEqual(typeof selectOne, 'function');
  assert.strictEqual(typeof selectMany, 'function');
  // Do NOT call them here: with no TTY they would wait on stdin forever and hang the run.
  // What matters is that selectMany still takes a preselect list — without it `sc setup`
  // silently loses the "pre-tick whatever is broken" behaviour that makes it useful.
  // (A defaulted param does not count toward Function.length, so check the signature text.)
  assert.match(selectMany.toString(), /^function selectMany\(\s*title,\s*items,\s*preselected/,
    'selectMany must accept (title, items, preselected)');
});
