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
  assert.ok(VALIDATORS.RESEND_API_KEY('re_1234567890abcdef'));
  assert.ok(!VALIDATORS.RESEND_API_KEY('convex-key'));
  assert.ok(VALIDATORS.COMPOSIO_API_KEY('ak_1234567890abcdef'));
  assert.ok(!VALIDATORS.COMPOSIO_API_KEY('ck_consumer_key_is_not_a_project_key'));
});

test('SCP-8: Resend and Composio are credential-ready providers, not setup stubs', () => {
  const resend = PROVIDERS.find(p => p.id === 'resend');
  const composio = PROVIDERS.find(p => p.id === 'composio');
  assert.strictEqual(resend?.status, 'implemented');
  assert.strictEqual(composio?.status, 'implemented');
  assert.deepStrictEqual(composio?.vars.map(v => v.key), ['COMPOSIO_API_KEY']);
});


test('SCP-9: Resend doctor accepts a valid Sending-access key without requiring domain-list permission', async () => {
  const resend = PROVIDERS.find(p => p.id === 'resend');
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options = {}) => {
    seen = { url: String(url), options };
    return new Response(JSON.stringify({ name: 'restricted_api_key', message: 'restricted' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await resend.check({ RESEND_API_KEY: 're_1234567890abcdef' });
    assert.strictEqual(result.ok, true);
    assert.match(result.detail, /Sending access/);
    assert.strictEqual(seen.url, 'https://api.resend.com/domains');
    assert.match(seen.options.headers.Authorization, /^Bearer re_/);
    assert.ok(seen.options.headers['User-Agent']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('SCP-10: Composio doctor sends the project key only in x-api-key to the v3 tools endpoint', async () => {
  const composio = PROVIDERS.find(p => p.id === 'composio');
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options = {}) => {
    seen = { url: String(url), options };
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await composio.check({ COMPOSIO_API_KEY: 'ak_1234567890abcdef' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(seen.url, 'https://backend.composio.dev/api/v3.1/tools?limit=1');
    assert.strictEqual(seen.options.headers['x-api-key'], 'ak_1234567890abcdef');
    assert.ok(!('Authorization' in seen.options.headers));
  } finally {
    global.fetch = originalFetch;
  }
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
  assert.match(out, /SI-Coder interactive console/);
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
  // Keep the API shape stable, but generic `sc setup` deliberately passes an empty default
  // selection so Enter cannot accidentally confirm unrelated Needs-fix providers.
  assert.match(selectMany.toString(), /^function selectMany\(\s*title,\s*items,\s*preselected/,
    'selectMany must accept (title, items, preselected)');
  const sc = fs.readFileSync(path.join(ROOT, 'bin/sc.js'), 'utf8');
  assert.match(sc, /selectMany\('Which providers do you want to set up\?', items, \[\], PROVIDER_TABS\)/,
    'generic setup must start with no implicit provider selection');
  const prompt = fs.readFileSync(path.join(ROOT, 'lib/prompt.js'), 'utf8');
  assert.match(prompt, /multi && selected\.size === 0 && cur\[cursor\].*selected\.add/,
    'Enter with no toggled boxes must choose the highlighted provider');
  assert.match(sc, /!env\[v\.key\] \|\| varState\(v, env\) === 'INVALID'/,
    'setup must re-prompt malformed values instead of treating their mere presence as complete');
});

test('SCC-7: bare sc is a Finder-style alternate-screen TUI, not a line-appending prompt loop', () => {
  const tui = require(path.join(ROOT, 'lib/finder-tui'));
  assert.strictEqual(typeof tui.selectFinderFrame, 'function');
  assert.strictEqual(typeof tui.enterAlternateScreen, 'function');
  assert.strictEqual(typeof tui.leaveAlternateScreen, 'function');
  const source = fs.readFileSync(path.join(ROOT, 'lib/finder-tui.js'), 'utf8');
  assert.match(source, /\?1049h/, 'must use the terminal alternate screen');
  assert.match(source, /SECTIONS/, 'top section tabs must be visible');
  assert.match(source, /PATH/, 'breadcrumb tab/path bar must be visible');
  assert.match(source, /Tab\/→ deeper/);
  assert.doesNotMatch(source, /\$\{ESC\}\[\$\{printed\}A/, 'Finder renderer must not walk upward through scrollback');
  const sc = fs.readFileSync(path.join(ROOT, 'bin/sc.js'), 'utf8');
  assert.match(sc, /enterAlternateScreen\(\)/, 'bare sc must enter one stable TUI frame');
  assert.match(sc, /menuColumns\(stack\)/, 'full breadcrumb stack must become Finder columns');
  assert.match(sc, /Esc\/Left at Home intentionally does not close the CLI/);
  assert.match(sc, /users\/user:/, 'user must be the first identity layer');
  assert.match(sc, /providers\/provider:/, 'providers must live under a selected user');
  assert.match(sc, /credentials\/credential:/, 'individual credentials must live under a user/provider path');
});

test('SCC-7b: Finder renderer paints tabs, path, columns and last action into one cleared frame', () => {
  const { renderFinderFrame } = require(path.join(ROOT, 'lib/finder-tui'));
  let out = '';
  const output = { isTTY: true, columns: 100, rows: 28, write(chunk) { out += String(chunk); } };
  const root = [
    { id: 'users', kind: 'branch', label: 'Users', hint: 'identities' },
    { id: 'catalog', kind: 'branch', label: 'Provider catalog', hint: 'definitions' },
  ];
  const users = [{ id: 'user:rahmanef', kind: 'branch', label: 'rahmanef', hint: '4 credentials · default' }];
  renderFinderFrame({
    title: 'SI-Coder',
    breadcrumb: ['SI-Coder', 'Users'],
    stack: [{ id: 'users', label: 'Users' }],
    columns: [
      { title: 'SI-Coder', items: root, selectedId: 'users' },
      { title: 'Users', items: users, selectedId: null },
    ],
    activeItems: users, cursor: 0, query: '',
    sections: [{ id: 'users', label: 'Users' }, { id: 'catalog', label: 'Providers' }],
    activity: ['owner : rahmanef'],
    output,
  });
  assert.ok(out.startsWith('\x1b[H\x1b[2J'), 'each render must home+clear the same frame');
  assert.match(out, /SECTIONS/);
  assert.match(out, /PATH/);
  assert.match(out, /│/, 'Finder columns must have visible separators');
  assert.match(out, /LAST ACTION/);
  assert.match(out, /owner : rahmanef/);
  assert.doesNotMatch(out, /\x1b\[\d+A/, 'render must never cursor-walk into previous lines');
});

test('SCC-8: profile ownership is configurable from the CLI without exposing credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-owner-cli-'));
  const env = { ...process.env, SC_CONFIG_DIR: dir };
  execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'user', 'add', 'alpha', '--owner', 'Rahman personal'],
    { encoding: 'utf8', env, timeout: 20000 });
  const shown = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'user', 'show', 'alpha'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(shown, /display owner:\s+Rahman personal/);
  assert.match(shown, /values hidden/);
  const listed = execFileSync(process.execPath, [path.join(ROOT, 'bin/sc.js'), 'user'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(listed, /alpha\s+0 credential\(s\)/);
  assert.match(listed, /ownership\s+:/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('SCC-9: user duplicate + user-scoped credential CRUD never exposes plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-user-crud-'));
  const env = { ...process.env, SC_CONFIG_DIR: dir };
  const cli = path.join(ROOT, 'bin/sc.js');
  execFileSync(process.execPath, [cli, 'user', 'add', 'source'], { encoding: 'utf8', env, timeout: 20000 });
  const token = 'ghp_' + 'a'.repeat(40);
  const setOut = execFileSync(process.execPath, [cli, 'user', 'credential-set', 'source', 'github', 'GITHUB_TOKEN', '--stdin'],
    { input: token + '\n', encoding: 'utf8', env, timeout: 20000 });
  assert.doesNotMatch(setOut, new RegExp(token));
  execFileSync(process.execPath, [cli, 'user', 'add', 'target'], { encoding: 'utf8', env, timeout: 20000 });
  const dup = execFileSync(process.execPath, [cli, 'user', 'duplicate', 'source', 'target', '--replace-empty'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(dup, /duplicated user "source" → "target"/);
  assert.doesNotMatch(dup, new RegExp(token));
  const status = execFileSync(process.execPath, [cli, 'user', 'credentials', 'target', 'github'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(status, /GITHUB_TOKEN/);
  assert.match(status, /owner target/);
  assert.doesNotMatch(status, new RegExp(token));
  execFileSync(process.execPath, [cli, 'user', 'credential-rm', 'target', 'github', 'GITHUB_TOKEN', '--yes'],
    { encoding: 'utf8', env, timeout: 20000 });
  const after = execFileSync(process.execPath, [cli, 'user', 'credentials', 'target', 'github'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(after, /GITHUB_TOKEN.*missing/);
  const guide = execFileSync(process.execPath, [cli, 'user', 'credential-status', 'target', 'github', 'GITHUB_TOKEN'],
    { encoding: 'utf8', env, timeout: 20000 });
  assert.match(guide, /sc user credential-set target github GITHUB_TOKEN/, 'user-scoped guidance must never fall back to the current-folder credential store');
  assert.doesNotMatch(guide, new RegExp(token));
  fs.rmSync(dir, { recursive: true, force: true });
});
