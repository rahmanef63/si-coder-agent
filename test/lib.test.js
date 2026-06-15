'use strict';

// RES-TEST-10: lib/ test blind-spot closure. Covers the resilience/security
// behaviors the Build phase landed in lib/tls.js, lib/convex.js, lib/hostinger.js
// and lib/env.js. Node built-ins only (node:test + node:assert) — NO new deps.
//
// Strategy: lib/convex.js captures `run` (lib/proc) and `waitForValidTls` (lib/tls)
// in module-local bindings at require time, so mutating the exported object after the
// fact would NOT intercept the internal calls. We instead pre-seed require.cache with
// stub modules BEFORE requiring lib/convex.js, then restore the real modules so the
// rest of the suite is unaffected.

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const LIB = path.join(__dirname, '..', 'lib');

// ---------------------------------------------------------------------------
// waitForValidTls (lib/tls.js)
// ---------------------------------------------------------------------------
const { waitForValidTls } = require('../lib/tls');

test('waitForValidTls: resolves true on a mocked OK HTTP response', async () => {
  const origFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { status: 200 }; };
  try {
    const ok = await waitForValidTls('api.example.com', {
      attempts: 3, delayMs: 1, timeoutMs: 50,
    });
    assert.equal(ok, true);
    assert.equal(calls, 1, 'should return on first OK response, not keep polling');
  } finally {
    global.fetch = origFetch;
  }
});

test('waitForValidTls: does NOT hang on a rejecting fetch — throws after attempts', async () => {
  const origFetch = global.fetch;
  let calls = 0;
  // Simulate a not-yet-issued / self-signed cert: native fetch rejects the chain.
  global.fetch = async () => { calls++; throw new Error('unable to verify the first certificate'); };
  try {
    await assert.rejects(
      waitForValidTls('api.example.com', { attempts: 2, delayMs: 1, timeoutMs: 50 }),
      /TLS not valid .* after 2 attempts: unable to verify the first certificate/,
    );
    assert.equal(calls, 2, 'should retry exactly `attempts` times then give up');
  } finally {
    global.fetch = origFetch;
  }
});

test('waitForValidTls: a fetch that aborts (timeout) leads to the documented timeout throw', async () => {
  const origFetch = global.fetch;
  // Honor the AbortSignal so the per-attempt timeout fires fast and we never hang.
  global.fetch = (url, { signal } = {}) => new Promise((_resolve, reject) => {
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
  });
  try {
    await assert.rejects(
      waitForValidTls('api.example.com', { attempts: 1, delayMs: 1, timeoutMs: 20 }),
      /TLS not valid .* timeout after 20ms/,
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('waitForValidTls: requires apiDomain', async () => {
  await assert.rejects(() => waitForValidTls(''), /apiDomain required/);
});

// ---------------------------------------------------------------------------
// deploySchema (lib/convex.js) — backend-targeting env contract.
//
// Pre-seed require.cache with stub ./proc + ./tls so the module-local bindings
// captured inside lib/convex.js are the stubs. We also stub assertConvexResolvable
// by faking convex/package.json resolution — simpler to monkeypatch the exported
// function after load (deploySchema calls it via the same module's closure though),
// so instead we make require.resolve succeed by intercepting it.
// ---------------------------------------------------------------------------
test('deploySchema: hands the convex CLI a self-hosted-only env (v1.27+ backend targeting)', async () => {
  const procPath = require.resolve('../lib/proc');
  const tlsPath = require.resolve('../lib/tls');
  const convexPath = require.resolve('../lib/convex');

  const savedProc = require.cache[procPath];
  const savedTls = require.cache[tlsPath];
  const savedConvex = require.cache[convexPath];

  // Capture what deploySchema passes to run().
  let runCall = null;
  const stubProc = new Module(procPath, module);
  stubProc.filename = procPath;
  stubProc.loaded = true;
  stubProc.exports = {
    run: (file, args, opts) => { runCall = { file, args, opts }; return ''; },
    dockerExec: () => '',
  };

  let tlsCalledWith = null;
  const stubTls = new Module(tlsPath, module);
  stubTls.filename = tlsPath;
  stubTls.loaded = true;
  stubTls.exports = {
    waitForValidTls: async (domain) => { tlsCalledWith = domain; return true; },
  };

  // Make assertConvexResolvable a no-op: intercept Module._resolveFilename for the
  // 'convex/package.json' lookup so require.resolve in lib/convex succeeds.
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) {
    if (request === 'convex/package.json') return '/fake/node_modules/convex/package.json';
    return origResolve.call(this, request, ...rest);
  };

  require.cache[procPath] = stubProc;
  require.cache[tlsPath] = stubTls;
  delete require.cache[convexPath]; // force re-require so it binds the stubs

  try {
    const { deploySchema } = require('../lib/convex');
    await deploySchema({
      apiDomain: 'api.myapp.example.com',
      adminKey: 'convex-self-hosted|deadbeef',
      cwd: '/tmp/app',
    });

    assert.equal(tlsCalledWith, 'api.myapp.example.com', 'waited for valid TLS on the api domain');
    assert.ok(runCall, 'run() was invoked');
    assert.equal(runCall.file, 'npx');
    assert.deepEqual(runCall.args, ['--yes', 'convex', 'deploy']);

    const env = runCall.opts.env;
    // The "targets the right backend on v1.27+" claim, asserted explicitly:
    assert.equal(env.CONVEX_SELF_HOSTED_URL, 'https://api.myapp.example.com');
    assert.equal(env.CONVEX_SELF_HOSTED_ADMIN_KEY, 'convex-self-hosted|deadbeef');
    // Cloud selectors neutralized so the schema can't be pushed to the wrong backend.
    assert.equal(env.CONVEX_DEPLOYMENT, '');
    assert.equal(env.CONVEX_DEPLOY_KEY, '');
    assert.equal(runCall.opts.cwd, '/tmp/app');
  } finally {
    Module._resolveFilename = origResolve;
    // Restore real modules so the rest of the suite (and other files) is unaffected.
    if (savedProc) require.cache[procPath] = savedProc; else delete require.cache[procPath];
    if (savedTls) require.cache[tlsPath] = savedTls; else delete require.cache[tlsPath];
    if (savedConvex) require.cache[convexPath] = savedConvex; else delete require.cache[convexPath];
  }
});

// ---------------------------------------------------------------------------
// extractAdminKey / ADMIN_KEY_RE (lib/convex.js)
// ---------------------------------------------------------------------------
const { extractAdminKey, ADMIN_KEY_RE } = require('../lib/convex');

test('extractAdminKey: accepts a plain hex key', () => {
  assert.equal(
    extractAdminKey('noise\nconvex-self-hosted|abc123def456\nmore noise'),
    'convex-self-hosted|abc123def456',
  );
});

test('extractAdminKey: accepts a versioned <name>|<tag>|<hex> key', () => {
  assert.equal(
    extractAdminKey('Admin key: convex-self-hosted|v1|deadbeefcafe'),
    'convex-self-hosted|v1|deadbeefcafe',
  );
});

test("extractAdminKey: accepts a base64url-tail key (widened ADMIN_KEY_RE)", () => {
  // Build-phase widening: final segment may be base64/base64url ([A-Za-z0-9+/_=.-]),
  // not hex-only. Underscore, hyphen, and `=` padding must all match.
  const key = 'convex-self-hosted|YWJjZA_-=';
  assert.ok(ADMIN_KEY_RE.test(key), 'ADMIN_KEY_RE should accept a base64url tail');
  assert.equal(extractAdminKey(`some log\n${key}\ntrailing`), key);
});

test('extractAdminKey: THROWS on noisy no-key output (no weak last-line fallback)', () => {
  const noisy = [
    'WARNING: container starting up',
    'level=info msg="waiting for database"',
    'docker run foo | bar baz',
    'some trailing diagnostic without a key',
  ].join('\n');
  assert.throws(() => extractAdminKey(noisy), /no line matched|key shape/i);
});

// ---------------------------------------------------------------------------
// configureDnsRecord (lib/hostinger.js) — A<->CNAME clash removal, TXT coexists
// ---------------------------------------------------------------------------
const { configureDnsRecord } = require('../lib/hostinger');

// Build a mocked fetch that serves the portfolio, the existing zone, and captures
// the PUT payload. Returns { fetch, getPut() }.
function mockHostingerFetch(zoneRecords) {
  let putBody = null;
  // Real fetch Responses always expose .text(); lib/hostinger now consumes the body via
  // .text() (under the live abort signal) and parses JSON from that string, so the mock
  // serves every body through .text() too.
  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('/portfolio')) {
      return { ok: true, status: 200, text: async () => JSON.stringify([{ domain: 'example.com' }]) };
    }
    if (u.includes('/zones/')) {
      if ((init.method || 'GET') === 'PUT') {
        putBody = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => 'ok' };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(zoneRecords) };
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return { fetch, getPut: () => putBody };
}

// configureDnsRecord sleeps a real 5s after a successful PUT (no injectable delay,
// and lib/hostinger.js is frozen). Drive that promise to completion under fake
// timers so the suite stays fast: enable mock.timers for setTimeout, kick off the
// async call, then repeatedly yield to the microtask queue + advance pending timers
// until the promise settles.
async function runUnderFakeTimers(fn) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false; let value; let err;
    const p = fn().then(v => { value = v; settled = true; }, e => { err = e; settled = true; });
    // Up to a few hundred interleavings: flush microtasks, then advance any pending timer.
    for (let i = 0; i < 500 && !settled; i++) {
      await Promise.resolve();
      mock.timers.tick(6000); // > the longest sleep (5000ms) in one go
    }
    await p;
    if (err) throw err;
    return value;
  } finally {
    mock.timers.reset();
  }
}

test('configureDnsRecord: adding an A record removes a clashing CNAME but keeps TXT', async () => {
  const origFetch = global.fetch;
  // Zone already has a CNAME for 'app' (clashes with the new A) and a TXT for 'app'
  // (must coexist) plus an unrelated record.
  const zone = [
    { name: 'app', type: 'CNAME', records: [{ content: 'old.target.example.' }] },
    { name: 'app', type: 'TXT', records: [{ content: 'v=spf1 -all' }] },
    { name: 'www', type: 'A', records: [{ content: '1.1.1.1' }] },
  ];
  const m = mockHostingerFetch(zone);
  global.fetch = m.fetch;
  try {
    const res = await runUnderFakeTimers(() => configureDnsRecord({
      fullDomain: 'app.example.com',
      type: 'A',
      target: '203.0.113.10',
      hostingerToken: 'tok',
    }));
    assert.equal(res.created, true);
    const put = m.getPut();
    assert.ok(put && Array.isArray(put.zone), 'PUT payload carries a zone array');

    const names = (t) => put.zone.filter(r => r.name === 'app' && r.type === t);
    // Clashing CNAME removed:
    assert.equal(names('CNAME').length, 0, 'clashing CNAME for app must be removed');
    // TXT for the same name coexists (NOT removed):
    assert.equal(names('TXT').length, 1, 'TXT on the same name must coexist');
    // New A record present with the right target:
    const a = names('A');
    assert.equal(a.length, 1, 'exactly one new A record for app');
    assert.equal(a[0].records[0].content, '203.0.113.10');
    // Unrelated record untouched:
    assert.ok(put.zone.some(r => r.name === 'www' && r.type === 'A'), 'unrelated www A kept');
  } finally {
    global.fetch = origFetch;
  }
});

test('configureDnsRecord: adding a CNAME removes a clashing A on the same name', async () => {
  const origFetch = global.fetch;
  const zone = [
    { name: 'app', type: 'A', records: [{ content: '198.51.100.1' }] },
    { name: 'app', type: 'TXT', records: [{ content: 'txt-value' }] },
  ];
  const m = mockHostingerFetch(zone);
  global.fetch = m.fetch;
  try {
    await runUnderFakeTimers(() => configureDnsRecord({
      fullDomain: 'app.example.com',
      type: 'CNAME',
      target: 'cname.target.example.com',
      hostingerToken: 'tok',
    }));
    const put = m.getPut();
    const appA = put.zone.filter(r => r.name === 'app' && r.type === 'A');
    const appCname = put.zone.filter(r => r.name === 'app' && r.type === 'CNAME');
    const appTxt = put.zone.filter(r => r.name === 'app' && r.type === 'TXT');
    assert.equal(appA.length, 0, 'clashing A removed when adding CNAME');
    assert.equal(appCname.length, 1, 'new CNAME added');
    assert.equal(appTxt.length, 1, 'TXT coexists');
  } finally {
    global.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// appendExportToShellRc (lib/env.js) — merge, idempotency, 0600 mode
// ---------------------------------------------------------------------------
const { appendExportToShellRc } = require('../lib/env');

test('appendExportToShellRc: merges prior managed keys, is idempotent, writes mode 0600', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rc-'));
  const rc = path.join(dir, 'rc');
  try {
    // Seed an rc file with unmanaged content + a prior managed block (separate run).
    fs.writeFileSync(rc, [
      '# user shell config',
      'export PATH="$PATH:/usr/local/bin"',
      '',
      '# --- si-coder onboarding ---',
      "export PRIOR_KEY='prior-value'",
      '# --- end si-coder onboarding ---',
      '',
    ].join('\n'), { mode: 0o644 });

    // First incremental run: add a NEW key; PRIOR_KEY must survive.
    appendExportToShellRc({ NEW_KEY: 'new-value' }, rc);
    const after1 = fs.readFileSync(rc, 'utf8');
    assert.match(after1, /export PRIOR_KEY='prior-value'/, 'prior managed key preserved');
    assert.match(after1, /export NEW_KEY='new-value'/, 'new key written');
    assert.match(after1, /# user shell config/, 'unmanaged content preserved');
    // Exactly ONE managed block (no duplication).
    assert.equal(
      (after1.match(/# --- si-coder onboarding ---/g) || []).length, 1,
      'a single managed block only',
    );

    // Idempotency: a second identical run yields byte-identical content.
    appendExportToShellRc({ NEW_KEY: 'new-value' }, rc);
    const after2 = fs.readFileSync(rc, 'utf8');
    assert.equal(after2, after1, 'second identical run is a no-op (idempotent)');

    // Secret file: owner-only mode 0600.
    const mode = fs.statSync(rc).mode & 0o777;
    assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendExportToShellRc: updates win over a prior managed value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rc-upd-'));
  const rc = path.join(dir, 'rc');
  try {
    appendExportToShellRc({ TOKEN: 'v1' }, rc);
    appendExportToShellRc({ TOKEN: 'v2' }, rc);
    const out = fs.readFileSync(rc, 'utf8');
    assert.match(out, /export TOKEN='v2'/, 'updated value present');
    assert.doesNotMatch(out, /export TOKEN='v1'/, 'stale value removed');
    assert.equal(
      (out.match(/export TOKEN=/g) || []).length, 1,
      'TOKEN appears exactly once',
    );
    assert.equal(fs.statSync(rc).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// SEC-1: a key the user exported OUTSIDE the managed block must NOT be silently
// overridden. appendExportToShellRc skips it (so the user's value still wins on
// `source`) and the managed block carries only the un-conflicting keys.
test('appendExportToShellRc: does NOT override a user export outside the managed block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-rc-sec-'));
  const rc = path.join(dir, 'rc');
  const origWarn = console.warn;
  let warned = '';
  console.warn = (...a) => { warned += a.join(' ') + '\n'; };
  try {
    fs.writeFileSync(rc, [
      'export GITHUB_TOKEN=ghp_existing',
      '',
    ].join('\n'), { mode: 0o644 });

    appendExportToShellRc({ GITHUB_TOKEN: 'ghp_OVERWRITTEN', NEW_KEY: 'fresh' }, rc);
    const out = fs.readFileSync(rc, 'utf8');

    // The user's pre-existing export is untouched and is the only GITHUB_TOKEN line.
    assert.match(out, /export GITHUB_TOKEN=ghp_existing/, 'user export preserved');
    assert.doesNotMatch(out, /ghp_OVERWRITTEN/, 'managed block must not add a shadowing override');
    assert.equal(
      (out.match(/export GITHUB_TOKEN=/g) || []).length, 1,
      'exactly one GITHUB_TOKEN export (no shadowing duplicate)',
    );
    // The non-conflicting key is still written into the managed block.
    assert.match(out, /export NEW_KEY='fresh'/, 'non-conflicting key still managed');
    // A warning surfaced the skip (documented "never overwrite silently").
    assert.match(warned, /GITHUB_TOKEN already exported/, 'skip is warned, not silent');
  } finally {
    console.warn = origWarn;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// convex-cloud.js (CC-3) — deriveCloudUrl / readInjectedUrl pure contracts +
// probeCloud timeout bounding (CC-1).
// ---------------------------------------------------------------------------
const { deriveCloudUrl, readInjectedUrl, probeCloud } = require('../lib/convex-cloud');

test('deriveCloudUrl: prod key -> https://<name>.convex.cloud', () => {
  assert.equal(
    deriveCloudUrl('prod:qualified-jaguar-123|eyJ2IjoxfQ'),
    'https://qualified-jaguar-123.convex.cloud',
  );
});

test('deriveCloudUrl: preview/project keys and malformed input -> null', () => {
  assert.equal(deriveCloudUrl('preview:branch-name|eyJ2IjoxfQ'), null, 'preview key carries no deployment name');
  assert.equal(deriveCloudUrl('project:my-proj|eyJ2IjoxfQ'), null, 'project key carries no deployment name');
  assert.equal(deriveCloudUrl('no-colon-here'), null, 'no colon -> null');
  assert.equal(deriveCloudUrl(''), null, 'empty -> null');
  assert.equal(deriveCloudUrl(null), null, 'null -> null');
  assert.equal(deriveCloudUrl('prod:|eyJ2IjoxfQ'), null, 'empty name -> null');
});

test('readInjectedUrl: reads the URL var from a temp .env.local (and null when absent)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-injected-'));
  try {
    fs.writeFileSync(
      path.join(dir, '.env.local'),
      'SOMETHING=else\nNEXT_PUBLIC_CONVEX_URL=https://happy-otter-7.convex.cloud\n',
    );
    assert.equal(
      readInjectedUrl({ cwd: dir }),
      'https://happy-otter-7.convex.cloud',
      'reads the default urlEnvVar',
    );
    assert.equal(
      readInjectedUrl({ cwd: dir, urlEnvVar: 'MISSING_VAR' }),
      null,
      'missing var -> null',
    );
    // No file at all -> null (no throw).
    assert.equal(
      readInjectedUrl({ cwd: dir, envFile: '.env.nope' }),
      null,
      'missing file -> null',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('probeCloud: a hung URL yields { error: "timeout after Nms" } (CC-1)', async () => {
  const origFetch = global.fetch;
  // Honor the AbortSignal so the per-request timeout fires fast and we never hang.
  global.fetch = (url, { signal } = {}) => new Promise((_resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => {
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    });
  });
  try {
    const results = await probeCloud({ deploymentUrl: 'https://happy-otter-7.convex.cloud', timeoutMs: 20 });
    assert.match(results.version.error, /timeout after 20ms/, 'hung probe is bounded, not hung');
    assert.match(results.jwks.error, /timeout after 20ms/, 'jwks probe also bounded');
  } finally {
    global.fetch = origFetch;
  }
});
