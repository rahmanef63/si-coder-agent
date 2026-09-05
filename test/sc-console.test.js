// sc-console.test.js — the provider registry is now DERIVED, and `sc` is what users drive.
// These lock the two properties that made the old hand-maintained registry go wrong
// (drift between the parallel maps) and the one that makes auto-launch safe (never
// prompt without a TTY, because that hangs CI instead of asking).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

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
  assert.ok(VALIDATORS.COMPOSIO_API_KEY('opaque_project_key_example'));
  // Key type/authorization is decided by the live API, not an undocumented prefix.
  assert.ok(!VALIDATORS.COMPOSIO_API_KEY('invalid key with whitespace'));
});

test('SCP-8: Resend and Composio are credential-ready providers, not setup stubs', () => {
  const resend = PROVIDERS.find(p => p.id === 'resend');
  const composio = PROVIDERS.find(p => p.id === 'composio');
  assert.strictEqual(resend?.status, 'implemented');
  assert.strictEqual(composio?.status, 'implemented');
  assert.deepStrictEqual(composio?.vars.map(v => v.key), ['COMPOSIO_API_KEY', 'COMPOSIO_ORG_API_KEY']);
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
  assert.match(out, /credential-set.*--stdin/, 'must point at the named-connection scriptable path');
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
  assert.match(sc, /selectMany\('Which providers do you want to connect\?', items, \[\], PROVIDER_TABS\.filter/,
    'generic setup must start with no implicit provider selection and hide stub capabilities');
  const prompt = fs.readFileSync(path.join(ROOT, 'lib/prompt.js'), 'utf8');
  assert.match(prompt, /multi && selected\.size === 0 && cur\[cursor\].*selected\.add/,
    'Enter with no toggled boxes must choose the highlighted provider');
  assert.match(sc, /existing\[v\.key\] === undefined \|\| \(VALIDATORS\[v\.key\] && !VALIDATORS\[v\.key\]\(existing\[v\.key\]\)\)/,
    'named-connection setup must re-prompt malformed values instead of treating presence as complete');
  assert.match(sc, /~\/.bashrc is not modified by first-run setup/, 'fresh setup must explicitly remain connection-scoped');
  const preflight = sc.slice(sc.indexOf('async function cmdPreflight'), sc.indexOf('function renderUserPlan'));
  assert.match(preflight, /const full = currentEnvFull\(\);[\s\S]*const env = full\.env;/,
    'interactive preflight must retain the resolved user when it hands off to named-connection setup');
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
  assert.match(sc, /connections\/connection:/, 'provider credentials must be grouped into named connections');
  assert.match(sc, /credentials\/credential:/, 'individual credentials must live under a user/provider/connection path');
  assert.match(sc, /UC\.previewForProvider/, 'provider rows must preview the explicitly selected user');
  assert.match(sc, /id: 'transfer'.*Import \/ export JSON/, 'Finder root must expose portable JSON transfer');
  assert.match(sc, /here === 'transfer'/, 'Finder Transfer section must expose export/import actions');
  assert.match(source, /showActivity = false/, 'stale result panel must disappear after navigation');
});

test('SCC-7a: Esc cancels credential line input without exiting the surrounding SC flow', async () => {
  const { askHidden, askVisible } = require(path.join(ROOT, 'lib/prompt'));
  const fakeInput = () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = value => { input.isRaw = Boolean(value); };
    input.resume = () => {};
    input.pause = () => {};
    return input;
  };
  const fakeOutput = () => ({ text: '', write(chunk) { this.text += String(chunk); } });

  let input = fakeInput();
  let output = fakeOutput();
  const hidden = askHidden('token: ', { escapeCancels: true, input, output });
  input.emit('data', Buffer.from('super-secret-value'));
  input.emit('data', Buffer.from('\x1b'));
  assert.strictEqual(await hidden, null);
  assert.doesNotMatch(output.text, /super-secret-value/, 'hidden credential bytes must never be echoed while Esc remains available');
  assert.strictEqual(input.isRaw, false, 'Esc must restore terminal raw mode before returning to SC');

  input = fakeInput();
  output = fakeOutput();
  const visible = askVisible('owner: ', { escapeCancels: true, input, output });
  input.emit('data', Buffer.from('example-owner'));
  input.emit('data', Buffer.from('\x1b'));
  assert.strictEqual(await visible, null);
  assert.match(output.text, /example-owner/, 'non-secret credential metadata may echo normally');
  assert.strictEqual(input.isRaw, false);
});

test('SCC-7a2: raw prompt preserves pasted bytes after Enter for the next raw prompt, but Esc discards its escape-sequence tail', async () => {
  const { askHidden, askVisible } = require(path.join(ROOT, 'lib/prompt'));
  const fakeInput = () => {
    const input = new EventEmitter();
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = value => { input.isRaw = Boolean(value); };
    input.resume = () => {};
    input.pause = () => {};
    return input;
  };
  const fakeOutput = () => ({ text: '', write(chunk) { this.text += String(chunk); } });

  let input = fakeInput();
  const hiddenOut = fakeOutput();
  const first = askHidden('token: ', { escapeCancels: true, input, output: hiddenOut });
  input.emit('data', Buffer.from('first-secret\r\nsecond-owner\r\n'));
  assert.strictEqual(await first, 'first-secret');
  assert.doesNotMatch(hiddenOut.text, /first-secret|second-owner/, 'hidden prompt must not echo the pasted secret or pending bytes');
  assert.strictEqual(input.isRaw, false);

  const visibleOut = fakeOutput();
  const second = askVisible('owner: ', { escapeCancels: true, input, output: visibleOut });
  assert.strictEqual(await second, 'second-owner');
  assert.match(visibleOut.text, /second-owner/, 'pending non-secret bytes should belong to the next raw prompt');
  assert.strictEqual(input.isRaw, false);

  input = fakeInput();
  const cancelOut = fakeOutput();
  const cancelled = askVisible('owner: ', { escapeCancels: true, input, output: cancelOut });
  input.emit('data', Buffer.from('\x1b[A'));
  assert.strictEqual(await cancelled, null);
  assert.strictEqual(input.isRaw, false);
  const nextOut = fakeOutput();
  const next = askVisible('next: ', { escapeCancels: true, input, output: nextOut });
  input.emit('data', Buffer.from('clean\r'));
  assert.strictEqual(await next, 'clean');
  assert.doesNotMatch(nextOut.text, /\[A/, 'Esc sequence tail must not leak into the next prompt');
});

function finderCupRows(raw) {
  const re = /\x1b\[(\d+);1H/g;
  const matches = [...String(raw).matchAll(re)];
  return matches.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : raw.length;
    return { row: Number(m[1]), text: String(raw).slice(start, end) };
  });
}

test('SCC-7b: Finder renderer keeps stable column slots and one fixed footer panel', () => {
  const { renderFinderFrame, stripAnsi } = require(path.join(ROOT, 'lib/finder-tui'));
  const root = [
    { id: 'users', kind: 'branch', label: 'Users', hint: 'identities' },
    { id: 'catalog', kind: 'branch', label: 'Provider catalog', hint: 'definitions' },
  ];
  const users = [{ id: 'user:rahmanef', kind: 'branch', label: 'rahmanef', hint: '4 credentials · default', preview: ['user rahmanef · default', '4 credential(s) · values hidden'] }];
  const userMenu = [{ id: 'providers', kind: 'branch', label: 'Providers', hint: 'provider credentials' }];
  const providers = [{ id: 'provider:github', kind: 'branch', label: '✅ github 1/2', hint: 'repo create + push', preview: ['user rahmanef › provider github', '1/2 credential(s) · ready'] }];

  const paint = ({ columns, activeItems, cursor = 0, activity = [] }) => {
    let out = '';
    const output = { isTTY: true, columns: 140, rows: 28, write(chunk) { out += String(chunk); } };
    renderFinderFrame({
      title: 'SI-Coder', breadcrumb: ['SI-Coder', 'Users'], stack: [{ id: 'users', label: 'Users' }],
      columns, activeItems, cursor, query: '',
      sections: [{ id: 'users', label: 'Users' }, { id: 'catalog', label: 'Providers' }], activity, output,
    });
    const rows = finderCupRows(out).map(r => stripAnsi(r.text));
    return { raw: out, clean: rows.join('\n'), rows };
  };

  const beforeProvider = paint({
    columns: [
      { title: 'SI-Coder', items: root, selectedId: 'users' },
      { title: 'Users', items: users, selectedId: 'user:rahmanef' },
      { title: 'rahmanef', items: userMenu, selectedId: null },
    ],
    activeItems: userMenu,
  });
  const inProvider = paint({
    columns: [
      { title: 'SI-Coder', items: root, selectedId: 'users' },
      { title: 'Users', items: users, selectedId: 'user:rahmanef' },
      { title: 'rahmanef', items: userMenu, selectedId: 'providers' },
      { title: 'Providers', items: providers, selectedId: null },
    ],
    activeItems: providers,
  });

  assert.ok(beforeProvider.raw.startsWith('\x1b[H\x1b[2J'), 'each render must home+clear the same frame');
  assert.doesNotMatch(beforeProvider.raw, /\n/, 'renderer must not stream newline-delimited rows that can scroll the alternate screen');
  assert.strictEqual(beforeProvider.rows.length, 28, 'renderer must address exactly the terminal row count');
  assert.strictEqual(inProvider.rows.length, 28, 'provider view must keep the same addressed frame height');
  assert.match(beforeProvider.raw, /\x1b\[1;1H/);
  assert.match(beforeProvider.raw, /\x1b\[28;1H/);

  const beforeHeader = beforeProvider.rows.find(line => line.includes('SI-Coder') && line.includes('Users') && line.includes('rahmanef'));
  const providerHeader = inProvider.rows.find(line => line.includes('SI-Coder') && line.includes('Users') && line.includes('rahmanef') && line.includes('Providers'));
  assert.ok(beforeHeader && providerHeader);
  assert.deepStrictEqual(
    [...beforeHeader.matchAll(/│/g)].map(m => m.index),
    [...providerHeader.matchAll(/│/g)].map(m => m.index),
    'opening Providers must fill the reserved fourth slot instead of resizing the first three columns',
  );
  assert.strictEqual([...providerHeader.matchAll(/│/g)].length, 3, 'wide view must render exactly four stable slots');
  assert.match(inProvider.clean, /PREVIEW/);
  assert.match(inProvider.clean, /user rahmanef › provider github/);
  assert.doesNotMatch(inProvider.clean, /RESULT/);
  const previewRow = inProvider.rows.find(row => row.includes('PREVIEW'));
  assert.ok(previewRow && finderCupRows(inProvider.raw).find(row => row.text.includes('PREVIEW')).row <= 20,
    '28-row terminals should reserve a taller lower description/help panel instead of leaving the center mostly empty');

  const withResult = paint({
    columns: [
      { title: 'SI-Coder', items: root, selectedId: 'users' },
      { title: 'Users', items: users, selectedId: null },
    ],
    activeItems: users,
    activity: ['owner : rahmanef'],
  });
  assert.match(withResult.clean, /RESULT/);
  assert.match(withResult.clean, /owner : rahmanef/);
  assert.doesNotMatch(withResult.clean, /PREVIEW/, 'RESULT replaces PREVIEW instead of changing footer height');
  assert.strictEqual(withResult.rows.length, 28);
  assert.doesNotMatch(withResult.raw, /\x1b\[\d+A/, 'render must never cursor-walk into previous lines');
});

test('SCC-7c: Finder slides the oldest column out after the fourth layer', () => {
  const { renderFinderFrame, stripAnsi } = require(path.join(ROOT, 'lib/finder-tui'));
  let out = '';
  const output = { isTTY: true, columns: 140, rows: 28, write(chunk) { out += String(chunk); } };
  const one = id => [{ id, kind: 'branch', label: id }];
  const columns = [
    { title: 'SI-Coder', items: one('users'), selectedId: 'users' },
    { title: 'Users', items: one('rahmanfakh'), selectedId: 'rahmanfakh' },
    { title: 'rahmanfakh', items: one('providers'), selectedId: 'providers' },
    { title: 'Providers', items: one('github'), selectedId: 'github' },
    { title: 'github', items: one('credentials'), selectedId: null },
  ];
  renderFinderFrame({
    title: 'SI-Coder', breadcrumb: ['SI-Coder', 'Users', 'rahmanfakh', 'Providers', 'github'],
    stack: [{ id: 'users', label: 'Users' }], columns, activeItems: one('credentials'), cursor: 0, query: '',
    sections: [{ id: 'users', label: 'Users' }], activity: [], output,
  });
  const rows = finderCupRows(out).map(r => stripAnsi(r.text));
  const columnHeader = rows.find(line => line.includes('… / Users') && line.includes('rahmanfakh') && line.includes('Providers') && line.includes('github'));
  assert.ok(columnHeader, 'fifth layer should slide SI-Coder out and keep the newest four columns');
  assert.strictEqual([...columnHeader.matchAll(/│/g)].length, 3);
});

test('SCC-7c2: Finder paints rows with cursor addressing and leaves a safe right margin', () => {
  const { renderFinderFrame, stripAnsi } = require(path.join(ROOT, 'lib/finder-tui'));
  let out = '';
  const output = { isTTY: true, columns: 160, rows: 24, write(chunk) { out += String(chunk); } };
  const items = [{ id: 'users', kind: 'branch', label: 'Users' }];
  renderFinderFrame({
    title: 'SI-Coder', breadcrumb: ['SI-Coder'], stack: [],
    columns: [{ title: 'SI-Coder', items, selectedId: null }], activeItems: items, cursor: 0, query: '',
    sections: [{ id: 'users', label: 'Users' }], activity: [], output,
  });
  const rows = finderCupRows(out);
  assert.strictEqual(rows.length, 24, 'one absolute cursor-addressed paint per terminal row');
  assert.doesNotMatch(out, /\n/, 'no streamed newlines: terminal cannot scroll the frame during redraw');
  assert.strictEqual(rows[0].row, 1);
  assert.strictEqual(rows.at(-1).row, 24);
  const separator = rows.map(r => stripAnsi(r.text)).find(line => /^─+$/.test(line));
  assert.ok(separator);
  assert.strictEqual([...separator].length, 159, '160-column terminal keeps one physical cell unused to prevent auto-wrap');
});

test('SCC-7d: deep provider navigation keeps Providers + selected provider anchored in four-column view', () => {
  const { chooseVisibleColumns } = require(path.join(ROOT, 'lib/finder-tui'));
  const col = (nodeId, title) => ({ nodeId, title, items: [], selectedId: null });
  const columns = [
    col('root', 'SI-Coder'),
    col('users', 'Users'),
    col('user:rahmanfakhr', 'rahmanfakhr'),
    col('providers', 'Providers'),
    col('provider:convex-cloud', 'convex-cloud'),
    col('connections', 'Connections'),
    col('connection:example-app-dev', 'Example App Dev'),
    col('credentials', 'Credentials'),
  ];
  assert.deepStrictEqual(
    chooseVisibleColumns(columns, 4).map(c => c.nodeId),
    ['providers', 'provider:convex-cloud', 'connection:example-app-dev', 'credentials'],
    'deep credentials view must not drop the Providers column',
  );
  const credentialAction = [...columns, col('credential:CONVEX_DEPLOY_KEY', 'CONVEX_DEPLOY_KEY')];
  assert.deepStrictEqual(
    chooseVisibleColumns(credentialAction, 4).map(c => c.nodeId),
    ['providers', 'provider:convex-cloud', 'connection:example-app-dev', 'credential:CONVEX_DEPLOY_KEY'],
    'credential action should keep provider + connection context and skip structural bridge columns',
  );
  assert.deepStrictEqual(
    chooseVisibleColumns(columns.slice(0, 5), 4).map(c => c.nodeId),
    ['users', 'user:rahmanfakhr', 'providers', 'provider:convex-cloud'],
    'provider entry must preserve the familiar v0.8.9 last-four layout',
  );
});

test('SCC-7e: fresh TTY setup stores GitHub access in a 0600 named connection and never writes ~/.bashrc', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fresh-setup-'));
  const home = path.join(dir, 'home');
  const config = path.join(dir, 'config');
  fs.mkdirSync(home, { recursive: true });
  const token = 'ghp_' + 'a'.repeat(40);
  try {
    const child = `${process.execPath} ${path.join(ROOT, 'bin/sc.js')} setup --providers github --user freshuser`;
    const feeder = `(printf '%s\\n' "$SC_TEST_TOKEN"; sleep 0.15; printf '\\n'; sleep 0.15) | script -qfec ${JSON.stringify(child)} /dev/null`;
    const r = spawnSync('bash', ['-lc', feeder], {
      cwd: ROOT,
      env: { ...process.env, HOME: home, SC_CONFIG_DIR: config, SC_TEST_TOKEN: token },
      encoding: 'utf8',
      timeout: 20000,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!fs.existsSync(path.join(home, '.bashrc')), 'fresh setup must not create or mutate ~/.bashrc');
    const file = path.join(config, 'connections', 'freshuser', 'github', 'default-github.env');
    assert.ok(fs.existsSync(file), 'fresh setup must create a named direct connection file');
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(fs.readFileSync(file, 'utf8').includes(token), 'credential should be stored only in the private connection file');
    const metadata = [
      fs.readFileSync(path.join(config, 'connections.json'), 'utf8'),
      fs.readFileSync(path.join(config, 'profile-meta.json'), 'utf8'),
      fs.readFileSync(path.join(config, 'sc.md'), 'utf8'),
    ].join('\n');
    assert.ok(!metadata.includes(token), 'credential bytes must never enter metadata');
    const connections = JSON.parse(fs.readFileSync(path.join(config, 'connections.json'), 'utf8'));
    const github = connections.users.freshuser.providers.github;
    assert.strictEqual(github.default, 'default-github');
    assert.strictEqual(github.connections['default-github'].authMethod, 'classic-pat');
    assert.strictEqual(github.connections['default-github'].source, 'sc');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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
  assert.match(listed, /alpha\s+0 connection\(s\).*0 field\(s\)/);
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

test('SCP-11: Composio doctor distinguishes organization token x-org-api-key from project x-api-key', async () => {
  const composio = PROVIDERS.find(p => p.id === 'composio');
  const originalFetch = global.fetch;
  let seen;
  global.fetch = async (url, options = {}) => {
    seen = { url: String(url), options };
    return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await composio.check({ COMPOSIO_ORG_API_KEY: 'organization-token-value-1234' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(seen.url, 'https://backend.composio.dev/api/v3.1/org/owner/project/list');
    assert.strictEqual(seen.options.headers['x-org-api-key'], 'organization-token-value-1234');
    assert.ok(!('x-api-key' in seen.options.headers));
  } finally {
    global.fetch = originalFetch;
  }
});
test('SCP-12: GitHub classic-PAT doctor distinguishes usable repo scope, public-only scope, missing scope, and SAML SSO blocks', async () => {
  const github = PROVIDERS.find(p => p.id === 'github');
  const originalFetch = global.fetch;
  const token = 'ghp_' + 'scopecheck'.repeat(5);
  try {
    global.fetch = async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, workflow' } });
    const repo = await github.check({ GITHUB_TOKEN: token });
    assert.strictEqual(repo.ok, true);
    assert.match(repo.detail, /private\+public repository automation/);

    global.fetch = async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'public_repo' } });
    const publicOnly = await github.check({ GITHUB_TOKEN: token, GH_OWNER: 'example-org' });
    assert.strictEqual(publicOnly.ok, true);
    assert.match(publicOnly.detail, /public repositories only/);
    assert.match(publicOnly.detail, /organization PAT policy\/SAML SSO/);

    global.fetch = async () => new Response(JSON.stringify({ login: 'octocat' }), { status: 200, headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'gist' } });
    const insufficient = await github.check({ GITHUB_TOKEN: token });
    assert.strictEqual(insufficient.ok, false);
    assert.match(insufficient.detail, /lacks repo\/public_repo scope/);

    global.fetch = async () => new Response(JSON.stringify({ message: 'Resource protected by organization SAML enforcement' }), { status: 403, headers: { 'content-type': 'application/json', 'x-github-sso': 'required; url=https://github.com/orgs/example/sso' } });
    const sso = await github.check({ GITHUB_TOKEN: token });
    assert.strictEqual(sso.ok, false);
    assert.match(sso.detail, /SAML SSO/);
  } finally {
    global.fetch = originalFetch;
  }
});
