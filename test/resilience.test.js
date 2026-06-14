'use strict';

// RES-RE-MINOR-1 + RES-RE-MINOR-2: resilience-engine coverage for the legacy
// /use-si-coder path. Two engines were previously asserted by comments only:
//
//  (A) scripts/deploy.js makeFetchers().fetchWithResilience — the wrapper around
//      EVERY Dokploy/GitHub call: per-attempt AbortController timeout, 429/5xx
//      retryable vs 4xx non-retryable classification (via the isHttpError
//      sentinel), exponential backoff (FETCH_BACKOFF_BASE_MS*2**(n-1)), and
//      network-error/abort retry up to FETCH_RETRIES.
//
//  (B) lib bounded fetches whose abort branch was untested:
//      lib/hostinger.js fetchWithTimeout (via configureDnsRecord), lib/convex.js
//      setBackendEnv, lib/convex.js probeBackend.
//
// Node built-ins only (node:test + node:assert). No new deps.

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const { makeFetchers } = require('../scripts/deploy.js');
const { configureDnsRecord } = require('../lib/hostinger');
const { setBackendEnv, probeBackend } = require('../lib/convex');

// fetchWithResilience drives its exponential backoff through setTimeout (delay()).
// Run the call under fake timers and repeatedly flush microtasks + advance pending
// timers so the backoff sleeps resolve without real wall-clock time. Mirrors the
// runUnderFakeTimers helper in test/lib.test.js.
async function runUnderFakeTimers(fn) {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let settled = false; let value; let err;
    const p = fn().then(v => { value = v; settled = true; }, e => { err = e; settled = true; });
    for (let i = 0; i < 500 && !settled; i++) {
      await Promise.resolve();
      mock.timers.tick(60000); // > any single backoff/timeout in one tick
    }
    await p;
    if (err) throw err;
    return value;
  } finally {
    mock.timers.reset();
  }
}

// Build a stub global.fetch that returns scripted Responses (each exposing .text(),
// since fetchWithResilience reads the body via res.text()). `script` is an array of
// { status, body } consumed one per call; a function entry is invoked instead.
function scriptedFetch(script) {
  let i = 0;
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const step = script[Math.min(i, script.length - 1)];
    i++;
    if (typeof step === 'function') return step(url, options);
    const body = step.body === undefined ? '{}' : step.body;
    return { ok: step.status >= 200 && step.status < 300, status: step.status, text: async () => body };
  };
  return { fetch, calls: () => calls, count: () => i };
}

// ---------------------------------------------------------------------------
// (A) scripts/deploy.js — fetchWithResilience (via fetchDokploy)
// ---------------------------------------------------------------------------

test('fetchWithResilience: a 500 then 200 retries once and succeeds', async () => {
  const origFetch = global.fetch;
  const s = scriptedFetch([{ status: 500, body: 'boom' }, { status: 200, body: '{"ok":true}' }]);
  global.fetch = s.fetch;
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    const data = await runUnderFakeTimers(() => fetchDokploy('/x'));
    assert.deepEqual(data, { ok: true }, '2nd attempt (200) result is returned');
    assert.equal(s.count(), 2, 'exactly one retry after the 500');
  } finally {
    global.fetch = origFetch;
  }
});

test('fetchWithResilience: a 404 throws immediately (isHttpError) and is NOT retried', async () => {
  const origFetch = global.fetch;
  const s = scriptedFetch([{ status: 404, body: 'nope' }, { status: 200, body: '{}' }]);
  global.fetch = s.fetch;
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    await assert.rejects(
      () => runUnderFakeTimers(() => fetchDokploy('/x')),
      (err) => {
        assert.equal(err.isHttpError, true, '4xx tagged with the isHttpError sentinel');
        assert.match(err.message, /Dokploy API Error 404/);
        return true;
      },
    );
    assert.equal(s.count(), 1, '4xx is non-retryable — no second attempt');
  } finally {
    global.fetch = origFetch;
  }
});

test('fetchWithResilience: a 429 is retried (retryable like 5xx)', async () => {
  const origFetch = global.fetch;
  const s = scriptedFetch([{ status: 429, body: 'slow down' }, { status: 200, body: '{"v":1}' }]);
  global.fetch = s.fetch;
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    const data = await runUnderFakeTimers(() => fetchDokploy('/x'));
    assert.deepEqual(data, { v: 1 });
    assert.equal(s.count(), 2, '429 retried once then succeeded');
  } finally {
    global.fetch = origFetch;
  }
});

test('fetchWithResilience: network/abort errors retry up to FETCH_RETRIES then throw lastErr', async () => {
  const origFetch = global.fetch;
  let calls = 0;
  // Always reject with a network-style error (never an HTTP error / sentinel).
  global.fetch = async () => { calls++; throw new Error('ECONNRESET'); };
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    await assert.rejects(
      () => runUnderFakeTimers(() => fetchDokploy('/x')),
      (err) => {
        assert.equal(err.isHttpError, undefined, 'network error is NOT an HTTP sentinel');
        assert.match(err.message, /ECONNRESET/, 'lastErr is surfaced after exhausting retries');
        return true;
      },
    );
    assert.equal(calls, 3, 'FETCH_RETRIES total attempts (3) before giving up');
  } finally {
    global.fetch = origFetch;
  }
});

test('fetchWithResilience: backoff follows FETCH_BACKOFF_BASE_MS*2**(n-1)', async () => {
  const origFetch = global.fetch;
  // Capture the actual sleep durations the engine schedules between retries.
  const origSetTimeout = global.setTimeout;
  const sleeps = [];
  global.fetch = async () => { throw new Error('net down'); };
  // Wrap setTimeout to record backoff durations. The per-attempt abort timer uses
  // FETCH_TIMEOUT_MS (30000); the backoff delay()s use 1000 then 2000. We record all
  // and assert the backoff values appear in order.
  global.setTimeout = (cb, ms, ...rest) => { sleeps.push(ms); return origSetTimeout(cb, 0, ...rest); };
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    await assert.rejects(() => fetchDokploy('/x'), /net down/);
    // Two backoffs between the 3 attempts: 1000*2**0 = 1000, 1000*2**1 = 2000.
    const backoffs = sleeps.filter(ms => ms === 1000 || ms === 2000);
    assert.deepEqual(backoffs, [1000, 2000], 'exponential backoff: 1000ms then 2000ms');
  } finally {
    global.fetch = origFetch;
    global.setTimeout = origSetTimeout;
  }
});

// A fetch that only rejects when its AbortSignal fires (a hung body/connect). Used to
// drive the per-attempt AbortController timeout path of every bounded fetch.
function hangingFetch() {
  return (url, { signal } = {}) => new Promise((_resolve, reject) => {
    if (signal) {
      signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
  });
}

test('fetchWithResilience: a per-attempt timeout (AbortError) is retried then surfaces', async () => {
  const origFetch = global.fetch;
  let aborts = 0;
  global.fetch = (url, { signal } = {}) => new Promise((_resolve, reject) => {
    if (signal) signal.addEventListener('abort', () => {
      aborts++;
      const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
    });
  });
  try {
    const { fetchDokploy } = makeFetchers({ baseUrl: 'https://dokploy.test', apiKey: 'k' });
    await assert.rejects(() => runUnderFakeTimers(() => fetchDokploy('/x')), /aborted/);
    assert.equal(aborts, 3, 'each of FETCH_RETRIES attempts aborts on its own timeout');
  } finally {
    global.fetch = origFetch;
  }
});

// ---------------------------------------------------------------------------
// (B) lib bounded-fetch abort branches — RES-RE-MINOR-2
// ---------------------------------------------------------------------------

test('lib/hostinger fetchWithTimeout: a hung request rejects with /timeout after \\d+ms/', async () => {
  const origFetch = global.fetch;
  global.fetch = hangingFetch();
  try {
    // resolveRoot's portfolio GET is the first bounded fetch. configureDnsRecord has no
    // timeout knob (fixed HOSTINGER_TIMEOUT_MS=15000), so drive that timer under fake
    // timers: its AbortController fires and configureDnsRecord (never-throws contract)
    // reports the reason — proving fetchWithTimeout's abort->`timeout after Nms` rethrow.
    const res = await runUnderFakeTimers(() => configureDnsRecord({
      fullDomain: 'app.example.com', type: 'A', target: '203.0.113.10',
      hostingerToken: 'tok',
    }));
    assert.equal(res.skipped, true);
    assert.match(res.reason, /timeout after \d+ms/, 'abort surfaces as a bounded timeout reason');
  } finally {
    global.fetch = origFetch;
  }
});

test('lib/convex setBackendEnv: a hung backend rejects with /Convex env set timeout after \\d+ms/', async () => {
  const origFetch = global.fetch;
  global.fetch = hangingFetch();
  try {
    await assert.rejects(
      setBackendEnv({
        apiDomain: 'api.example.com',
        adminKey: 'convex-self-hosted|deadbeef',
        changes: { FOO: 'bar' },
        timeoutMs: 20, // tiny so the abort fires immediately and the suite stays fast
      }),
      /Convex env set timeout after 20ms/,
    );
  } finally {
    global.fetch = origFetch;
  }
});

test('lib/convex probeBackend: a hung URL yields { error: "timeout after Nms" }', async () => {
  const origFetch = global.fetch;
  global.fetch = hangingFetch();
  try {
    const results = await probeBackend({ apiDomain: 'api.example.com', timeoutMs: 20 });
    assert.match(results.api_version.error, /timeout after 20ms/, 'hung probe is bounded, not hung');
  } finally {
    global.fetch = origFetch;
  }
});
