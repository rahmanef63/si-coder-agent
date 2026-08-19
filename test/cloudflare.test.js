'use strict';

// lib/cloudflare.js coverage — locks the sc-cf DNS contract in against regression.
// Node built-ins only (node:test + node:assert). No new deps. Mocks global.fetch.
//
//  SCF-1  resolveZone picks the LONGEST matching zone suffix, so a delegated subdomain
//         zone beats its parent instead of the first row that happens to match.
//  SCF-2  resolveZone pages through GET /zones — an unpaginated list truncates at 20 and
//         would report "not in account" for a zone that plainly exists.
//  SCF-3  resolveZone on a domain in no zone -> { error }, never a throw.
//  SCF-4  configureDnsRecord with no token writes nothing AND issues ZERO fetch calls.
//  SCF-5  record absent -> POST, with proxied:false SENT EXPLICITLY by default.
//  SCF-6  record already correct -> not one mutating request, { alreadyExists:true }.
//  SCF-7  wrong content -> PATCH to /dns_records/{id}: one record, never the zone.
//  SCF-8  a record left orange-cloud is NOT "already correct" — it needs an update, or
//         cert issuance stays broken forever while the module reports success.
//  SCF-9  A-vs-CNAME clash -> exactly one DELETE of the clashing id, then a POST.
//  SCF-10 TXT coexists with everything (SPF/DKIM/ACME) and must NEVER trigger a DELETE.
//  SCF-11 { success:false, errors:[{code,message}] } -> { skipped:true } carrying the code,
//         and the token value never appears in the reason.
//  SCF-12 a hung request is bounded by the timeout -> { skipped:true }, not a hang.
//  SCF-13 the per-record write guard refuses bulk/collection endpoints in code.
//  SCF-14 ttl is part of "correct" — a requested TTL change is applied, not reported as a
//         no-op, so a pre-cutover TTL drop actually takes effect.
//  SCF-15 a target whose shape is wrong for the type is refused BEFORE any request, so it can
//         never cost the live record the clash path would have deleted to make room.
//  SCF-16 when the clash is deleted and the replacement create then fails, the deleted record
//         is restored and the result says so — `skipped:true` alone would claim a no-op.
//  SCF-17 a restore that itself fails still returns (never throws) and reports restored:false.
//  SCF-18 the unfiltered record listing pages, so a record past row 100 is not invisible.
//  SCF-19 makeClient's configureDns* keep the never-throws contract when the token is missing.
//
// WHY the negative assertions carry the weight here: lib/hostinger.js GETs a whole zone,
// mutates the array and PUTs it back, so any bug there wipes every record in the domain.
// The Cloudflare path exists to make that impossible, which is a property of the requests
// it does NOT make. Hence the request log is inspected, not just the return value.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  makeClient, configureDns, configureDnsRecord, resolveZone, createRecord, listRecords,
} = require('../lib/cloudflare');

// lib/cloudflare.js falls back to process.env for both the token and the zone pin, so a
// developer with CLOUDFLARE_* exported in their shell would silently change what these
// tests exercise (a pinned zone id skips resolveZone entirely). Clear both for the file.
const ENV_KEYS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID'];
const SAVED_ENV = {};
for (const k of ENV_KEYS) { SAVED_ENV[k] = process.env[k]; delete process.env[k]; }
process.on('exit', () => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

// The live zone under test. Its apex A points at a real Shopify storefront, so a mutating
// request that names it would take down a production store — several tests assert that
// neither the apex name, its content, nor its record id ever reaches the wire.
const ZONE = 'antinrml.com';
const ZONE_ID = 'zonedeadbeefdeadbeefdeadbeefdead';
const APEX_A_CONTENT = '23.227.38.65';
const APEX_REC_ID = 'recapex00000000000000000000apex';
const SUB = 'be.antinrml.com';
const VPS_IP = '203.0.113.10';
const REC_ID = 'reccafebabecafebabecafebabecafe';
const TOKEN = 'cf_super_secret_token_abcdef1234567890';

// Minimal fetch stub: `route(url, init)` returns { status, body }. Body is JSON-stringified
// unless already a string. Shapes match what lib/cloudflare.js fetchWithTimeout consumes —
// it reads the body via .text() under the live abort signal, so .text() is the only accessor
// the stub needs. Every call is recorded so the negative assertions have something to read.
function mockFetch(route) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || 'GET';
    calls.push({ url: u, method, raw: init.body || '', body: init.body ? JSON.parse(init.body) : null });
    const r = route(u, init);
    if (!r) throw new Error(`unexpected fetch ${method} ${u}`);
    const body = r.body === undefined ? '{}' : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body };
  };
  return {
    fetch,
    calls: () => calls,
    // "Mutating" is the interesting set: every safety property is about these.
    writes: () => calls.filter(c => c.method !== 'GET'),
  };
}

// Cloudflare wraps every v4 response in { success, errors, messages, result, result_info }.
const cfOk = (result, resultInfo) => ({
  status: 200,
  body: { success: true, errors: [], messages: [], result, ...(resultInfo ? { result_info: resultInfo } : {}) },
});
const cfErr = (status, code, message) => ({
  status,
  body: { success: false, errors: [{ code, message }], messages: [], result: null },
});

// A fetch that only ever rejects when its AbortSignal fires. Mirrors hangingFetch in
// test/resilience.test.js; drives the per-request AbortController timeout path.
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

const qs = (url) => new URL(url).searchParams;
const isZoneProbe = (url) => url.includes('/zones?name=');
const isZoneList = (url) => url.includes('/zones?per_page=');
// The record listing is filtered with `name.exact` dot-notation, not a bare `name=`.
const isRecordList = (url) => url.includes('/dns_records?');

// Serve the one zone every DNS op starts from, for whichever candidate matches it.
const zoneProbe = (url) => (qs(url).get('name') === ZONE ? cfOk([{ id: ZONE_ID, name: ZONE }]) : cfOk([]));

// Fast settings for every call: no post-write settle sleep, and a timeout small enough that
// the abort branch fires immediately instead of holding the suite for 15s.
const FAST = { settleMs: 0, timeoutMs: 200 };

// ---------------------------------------------------------------------------
// resolveZone — longest suffix, pagination, and the never-throws error channel
// ---------------------------------------------------------------------------

test('resolveZone (SCF-1): picks the LONGEST matching zone suffix, not the first match', async () => {
  const orig = global.fetch;
  // Both a delegated subdomain zone and its parent exist on the account. A first-match walk
  // (the latent bug in lib/hostinger.js resolveRoot) would bind the record to the parent.
  const m = mockFetch((url) => {
    if (!isZoneProbe(url)) return null;
    const name = qs(url).get('name');
    if (name === 'sub.antinrml.com') return cfOk([{ id: 'zone_sub', name: 'sub.antinrml.com' }]);
    if (name === ZONE) return cfOk([{ id: ZONE_ID, name: ZONE }]);
    return cfOk([]);
  });
  global.fetch = m.fetch;
  try {
    const r = await resolveZone('x.sub.antinrml.com', TOKEN, { timeoutMs: 200 });
    assert.equal(r.zoneId, 'zone_sub', 'the delegated child zone wins over its parent');
    assert.equal(r.zoneName, 'sub.antinrml.com');
    assert.equal(r.recordName, 'x.sub.antinrml.com', 'recordName is the full FQDN, never an @ sentinel');
    assert.equal(m.calls().length, 2, 'probing longest-first stops at the first hit — the parent is never queried');
  } finally { global.fetch = orig; }
});

test('resolveZone (SCF-2): pages through a multi-page GET /zones and still takes the longest suffix', async () => {
  const orig = global.fetch;
  // A token whose listing ignores the ?name= filter forces the enumerate fallback. Page 1 is
  // full and holds only the parent zone; the real (longer) match is on page 2 — an
  // unpaginated read would report "not in account" for a zone that is plainly there.
  const page1 = [];
  for (let i = 0; i < 49; i++) page1.push({ id: `zone_filler_${i}`, name: `filler${i}.example.com` });
  page1.push({ id: ZONE_ID, name: ZONE });
  const m = mockFetch((url) => {
    if (isZoneProbe(url)) return cfOk([]); // name filter yields nothing usable
    if (!isZoneList(url)) return null;
    const page = Number(qs(url).get('page'));
    const info = { page, per_page: 50, count: 50, total_count: 51, total_pages: 2 };
    if (page === 1) return cfOk(page1, info);
    if (page === 2) return cfOk([{ id: 'zone_sub', name: 'sub.antinrml.com' }], { ...info, count: 1 });
    return cfOk([], { ...info, count: 0 });
  });
  global.fetch = m.fetch;
  try {
    const r = await resolveZone('x.sub.antinrml.com', TOKEN, { timeoutMs: 200 });
    assert.equal(r.zoneId, 'zone_sub', 'a zone that only appears on page 2 is still found');
    const pages = m.calls().filter(c => isZoneList(c.url)).map(c => qs(c.url).get('page'));
    assert.deepEqual(pages, ['1', '2'], 'both pages are fetched, and the walk stops at total_pages');
  } finally { global.fetch = orig; }
});

test('resolveZone (SCF-3): a domain in no zone yields { error }, never a throw', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url) => {
    if (isZoneProbe(url)) return cfOk([]);
    if (isZoneList(url)) return cfOk([], { page: 1, per_page: 50, count: 0, total_count: 0, total_pages: 0 });
    return null;
  }).fetch;
  try {
    const r = await resolveZone('nope.example.org', TOKEN, { timeoutMs: 200 });
    assert.equal(r.zoneId, undefined, 'no zone id is invented');
    assert.match(r.error, /not in account/, 'the miss is reported on the { error } channel');
    assert.match(r.error, /Zone:Read|CLOUDFLARE_ZONE_ID/, 'and names the likely token-scope cause');
  } finally { global.fetch = orig; }
});

// ---------------------------------------------------------------------------
// configureDnsRecord — the never-throws { skipped, ... } contract
// ---------------------------------------------------------------------------

test('configureDnsRecord (SCF-4): no token -> { skipped:true } and ZERO fetch calls', async () => {
  const orig = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('no request may be attempted without a token'); };
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, ...FAST });
    assert.equal(res.skipped, true, 'nothing was written');
    assert.match(res.reason, /missing token/, 'the missing input is named in the reason');
    assert.equal(calls, 0, 'the guard runs before the network — an unauthenticated call is never made');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-5): record absent -> POST with proxied:false by default', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) return cfOk([]); // neither an A nor a clashing CNAME exists
    if ((init.method || 'GET') === 'POST') return cfOk({ id: REC_ID, name: SUB, type: 'A', content: VPS_IP, proxied: false });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, false, 'skipped:false is the only success signal consumers branch on');
    assert.equal(res.created, true, 'a new record was created');

    const writes = m.writes();
    assert.equal(writes.length, 1, 'exactly one record is touched — the rest of the zone is untouched');
    assert.equal(writes[0].method, 'POST');
    assert.ok(writes[0].url.endsWith('/dns_records'), 'POST goes to the per-record collection, with no bulk suffix');
    assert.equal(writes[0].body.type, 'A');
    assert.equal(writes[0].body.name, SUB, 'the record is named by full FQDN, never a bare label');
    assert.equal(writes[0].body.content, VPS_IP);
    assert.ok('proxied' in writes[0].body, 'proxied must be SENT explicitly — the server default is not guaranteed grey');
    assert.equal(writes[0].body.proxied, false, 'grey cloud so Traefik can answer the ACME HTTP-01 challenge on :80');
    assert.ok(!Array.isArray(writes[0].body), 'a mutating body is one record object, never an array of records');
    assert.ok(!('zone' in writes[0].body), 'no whole-zone payload may ever be sent');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-5): proxied:true is honored only as an explicit caller opt-in', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) return cfOk([]);
    if ((init.method || 'GET') === 'POST') return cfOk({ id: REC_ID, proxied: true });
    return null;
  });
  global.fetch = m.fetch;
  try {
    await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, proxied: true, ...FAST });
    const body = m.writes()[0].body;
    assert.equal(body.proxied, true, 'a literal true opts in');
    assert.equal(body.ttl, 1, 'a proxied record must carry ttl:1 — Cloudflare rejects a numeric TTL with the proxy on');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-5): a truthy non-boolean does NOT turn the proxy on', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) return cfOk([]);
    if ((init.method || 'GET') === 'POST') return cfOk({ id: REC_ID });
    return null;
  });
  global.fetch = m.fetch;
  try {
    // The string "false" out of a config file or a CLI flag is truthy. An orange cloud costs
    // the Let's Encrypt cert and the Convex websocket transport, so the check is `=== true`.
    await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, proxied: 'false', ...FAST });
    assert.equal(m.writes()[0].body.proxied, false, 'only a literal boolean true may enable the proxy');
  } finally { global.fetch = orig; }
});

test('createRecord (SCF-5): the low-level writer applies the same === true proxy guard', async () => {
  const orig = global.fetch;
  const m = mockFetch(() => cfOk({ id: REC_ID }));
  global.fetch = m.fetch;
  try {
    // configureDnsRecord normalizes `proxied` to a boolean before it gets here, so this is
    // the second, independent gate: a call site that reaches createRecord directly (the CLI,
    // makeClient) must not be able to enable the proxy with a truthy string either.
    await createRecord({
      zoneId: ZONE_ID, name: SUB, type: 'A', content: VPS_IP,
      proxied: 'yes', cloudflareToken: TOKEN, timeoutMs: 200,
    });
    assert.equal(m.writes()[0].body.proxied, false, 'a truthy non-boolean still means grey cloud');
  } finally { global.fetch = orig; }
});

test('createRecord (SCF-5): an out-of-band ttl falls back to automatic rather than being rejected', async () => {
  const orig = global.fetch;
  const m = mockFetch(() => cfOk({ id: REC_ID }));
  global.fetch = m.fetch;
  try {
    // Cloudflare accepts ttl 1 ("automatic", 300s) or 60-86400 on Free/Pro/Business plans.
    // 30 is Enterprise-only, so sending it verbatim would fail the write after the fact.
    await createRecord({
      zoneId: ZONE_ID, name: SUB, type: 'A', content: VPS_IP,
      ttl: 30, cloudflareToken: TOKEN, timeoutMs: 200,
    });
    assert.equal(m.writes()[0].body.ttl, 1, 'an illegal TTL degrades to automatic, not to a failed write');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-6): an already-correct record issues no write at all', async () => {
  const orig = global.fetch;
  const m = mockFetch((url) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // ttl is part of the fixture because a real Cloudflare record always reports one, and
    // "correct" includes it — see SCF-14. Omitting it here modelled a response shape the API
    // does not produce.
    if (isRecordList(url)) return cfOk([{ id: REC_ID, type: 'A', name: SUB, content: VPS_IP, proxied: false, ttl: 1 }]);
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.alreadyExists, true, 'a correct record is benign, not a rewrite');
    assert.equal(res.skipped, false, 'alreadyExists is a success, not a skip');
    assert.equal(res.created, undefined, 'nothing was created');
    assert.equal(m.writes().length, 0, 'an idempotent run must write nothing at all');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-7): wrong content -> PATCH to /dns_records/{id}, one record not the zone', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) {
      // The listing also carries the live apex A, to prove the client-side re-verification
      // of the server filter keeps it out of the write path entirely.
      const type = qs(url).get('type');
      if (type !== 'A') return cfOk([]);
      return cfOk([
        { id: REC_ID, type: 'A', name: SUB, content: '198.51.100.9', proxied: false },
      ]);
    }
    if ((init.method || 'GET') === 'PATCH') return cfOk({ id: REC_ID, content: VPS_IP, proxied: false });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, false);
    assert.equal(res.updated, true, 'a stale target is corrected in place');
    assert.equal(res.created, true, 'created stays set on the update path so no existing .created check regresses');

    const writes = m.writes();
    assert.equal(writes.length, 1, 'exactly one mutating call — never delete-and-recreate churn');
    assert.equal(writes[0].method, 'PATCH', 'PATCH ("Edit"), never PUT ("Overwrite") which resets omitted fields');
    assert.ok(writes[0].url.endsWith(`/dns_records/${REC_ID}`), 'the PATCH URL carries the exact record id');
    assert.ok(writes[0].url.includes(REC_ID), 'the record id is in the URL — this edits one record, not the zone');
    assert.equal(writes[0].body.content, VPS_IP);
    assert.equal(writes[0].body.proxied, false, 'an update must not silently flip the record to proxied');
    assert.ok(!writes[0].raw.includes(APEX_A_CONTENT), 'the live apex A content never appears in a mutating body');
    assert.ok(!writes[0].url.includes(APEX_REC_ID), 'the apex record id is never a mutation target');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-8): a record left proxied is NOT already-correct — it needs an update', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // Content is right; only the proxy flag differs. A content-only comparison would report
    // alreadyExists while cert issuance stays broken forever — an invisible failure.
    if (isRecordList(url)) return cfOk([{ id: REC_ID, type: 'A', name: SUB, content: VPS_IP, proxied: true }]);
    if ((init.method || 'GET') === 'PATCH') return cfOk({ id: REC_ID, proxied: false });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.alreadyExists, undefined, 'an orange-cloud record is not "correct" when DNS-only was asked for');
    assert.equal(res.updated, true);
    const writes = m.writes();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].body.proxied, false, 'the PATCH flips the record back to grey cloud explicitly');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-9): an A-vs-CNAME clash is exactly one DELETE of that id, then a POST', async () => {
  const orig = global.fetch;
  const CNAME_ID = 'recclash000000000000000000clash';
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) {
      const type = qs(url).get('type');
      if (type === 'CNAME') return cfOk([{ id: CNAME_ID, type: 'CNAME', name: SUB, content: 'old.target.example.com.' }]);
      return cfOk([]);
    }
    const method = init.method || 'GET';
    if (method === 'DELETE') return cfOk({ id: CNAME_ID });
    if (method === 'POST') return cfOk({ id: REC_ID, name: SUB, content: VPS_IP });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.created, true);

    const writes = m.writes();
    const deletes = writes.filter(c => c.method === 'DELETE');
    assert.equal(deletes.length, 1, 'exactly one record is removed — never a bulk clear');
    assert.ok(deletes[0].url.endsWith(`/dns_records/${CNAME_ID}`), 'the DELETE names the clashing record id it looked up');
    assert.deepEqual(writes.map(c => c.method), ['DELETE', 'POST'], 'the clash is removed first, then the A is created');
    assert.ok(!writes.some(c => c.url.includes(APEX_REC_ID)), 'no unrelated record id is ever a write target');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-10): a TXT record on the same name triggers no DELETE', async () => {
  const orig = global.fetch;
  const TXT_ID = 'rectxt00000000000000000000000txt';
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) {
      const type = qs(url).get('type');
      // TXT legitimately coexists with anything — SPF/DKIM and the ACME DNS-01 challenge all
      // live there. Removing it to make room for an A would break mail and cert renewal.
      if (type === 'TXT') return cfOk([{ id: TXT_ID, type: 'TXT', name: SUB, content: 'v=spf1 -all' }]);
      return cfOk([]);
    }
    if ((init.method || 'GET') === 'POST') return cfOk({ id: REC_ID });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.created, true);
    const writes = m.writes();
    assert.equal(writes.filter(c => c.method === 'DELETE').length, 0, 'a coexisting TXT is never deleted');
    assert.ok(!writes.some(c => c.url.includes(TXT_ID)), 'the TXT record id never reaches a write URL');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-10): creating a TXT record deletes nothing either', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // An A already sits on the name; a TXT alongside it is legal and must not displace it.
    if (isRecordList(url)) {
      const type = qs(url).get('type');
      if (type === 'A') return cfOk([{ id: APEX_REC_ID, type: 'A', name: SUB, content: VPS_IP }]);
      return cfOk([]);
    }
    if ((init.method || 'GET') === 'POST') return cfOk({ id: 'rectxtnew0000000000000000000new' });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'TXT', target: 'hello', cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.created, true);
    assert.deepEqual(m.writes().map(c => c.method), ['POST'], 'a TXT create is a POST and nothing else');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-11): { success:false } -> { skipped:true } with the CF code, token-free', async () => {
  const orig = global.fetch;
  const origLog = console.log;
  const origWarn = console.warn;
  let logged = '';
  console.log = (...a) => { logged += a.join(' ') + '\n'; };
  console.warn = (...a) => { logged += a.join(' ') + '\n'; };
  global.fetch = mockFetch((url) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // 9109: the token is valid but its policy does not cover this zone. HTTP 403 with a
    // success:false envelope — res.ok alone would already have caught this one, but the
    // envelope is the authority since Cloudflare can answer 200 with success:false.
    if (isRecordList(url)) return cfErr(403, 9109, 'Unauthorized to access requested resource');
    return null;
  }).fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true, 'configure* never throws — it reports');
    assert.match(res.reason, /9109/, 'the Cloudflare error code is machine-readable in the reason');
    assert.match(res.reason, /Unauthorized to access requested resource/, 'and the human message survives');
    assert.ok(!res.reason.includes(TOKEN), 'the token value must never leak into a reason string');
    assert.ok(!logged.includes(TOKEN), 'nor into the log, not even on the error path');
    assert.ok(!logged.includes(TOKEN.slice(0, 12)), 'not even a guessable prefix of it');
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    global.fetch = orig;
  }
});

test('configureDnsRecord (SCF-11): a success:false envelope on HTTP 200 is still a failure', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // res.ok is true here. Branching on it alone would treat this as an empty record list
    // and go straight to POST — writing over whatever Cloudflare declined to tell us about.
    if (isRecordList(url)) return { status: 200, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }], messages: [], result: null } };
    return null;
  }).fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true, 'HTTP 200 + success:false is a failure, not an empty result');
    assert.match(res.reason, /10000/, 'the envelope error code reaches the caller');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-12): a hung request is bounded by the timeout, not a hang', async () => {
  const orig = global.fetch;
  global.fetch = hangingFetch();
  try {
    const res = await configureDnsRecord({
      fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN,
      settleMs: 0,
      timeoutMs: 20, // tiny so the abort fires immediately and the suite stays fast
    });
    assert.equal(res.skipped, true, 'a bounded failure, returned rather than thrown');
    assert.match(res.reason, /timeout after 20ms/, 'abort surfaces as a bounded timeout reason');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-12): headers-then-stalled-body is bounded by the same timeout', async () => {
  const orig = global.fetch;
  // The abort timer must stay armed ACROSS the .text() read. A backend that sends headers
  // and then stalls the body would otherwise hang a zero-human run forever, because Node's
  // global fetch has no default request timeout of its own.
  global.fetch = async (url, { signal } = {}) => ({
    ok: true,
    status: 200,
    text: () => new Promise((_resolve, reject) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    }),
  });
  try {
    const res = await configureDnsRecord({
      fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, settleMs: 0, timeoutMs: 20,
    });
    assert.equal(res.skipped, true);
    assert.match(res.reason, /timeout after 20ms/, 'the body read is inside the timeout window, not outside it');
  } finally { global.fetch = orig; }
});

// ---------------------------------------------------------------------------
// The safety guard — bulk / collection writes are unreachable by construction
// ---------------------------------------------------------------------------

test('makeClient (SCF-13): bulk and collection-level writes are refused before the network', async () => {
  const orig = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('no bulk request may reach the wire'); };
  try {
    const cf = makeClient({ apiToken: TOKEN, timeoutMs: 200 });
    // These are all real Cloudflare endpoints that write many records at once — the exact
    // shape of the Hostinger whole-zone PUT this module exists to avoid.
    await assert.rejects(() => cf.call(`/zones/${ZONE_ID}/dns_records/batch`, 'POST', {}), /bulk endpoint/);
    await assert.rejects(() => cf.call(`/zones/${ZONE_ID}/dns_records/import`, 'POST', {}), /bulk endpoint/);
    await assert.rejects(() => cf.call(`/zones/${ZONE_ID}/dns_records/scan`, 'POST', {}), /bulk endpoint/);
    // PUT is "Overwrite": fields omitted from the body revert to defaults, which could
    // silently flip an intentionally grey-cloud record back to proxied.
    await assert.rejects(() => cf.call(`/zones/${ZONE_ID}/dns_records/${REC_ID}`, 'PUT', {}), /refusing PUT/);
    // A PATCH with no record id addresses the whole collection — that IS a zone write.
    await assert.rejects(() => cf.call(`/zones/${ZONE_ID}/dns_records`, 'PATCH', {}), /whole-zone write/);
    assert.equal(calls, 0, 'the guard is structural: not one of these reached fetch');
  } finally { global.fetch = orig; }
});

test('makeClient (SCF-13): a per-record POST and PATCH pass the guard unchanged', async () => {
  const orig = global.fetch;
  const m = mockFetch(() => cfOk({ id: REC_ID }));
  global.fetch = m.fetch;
  try {
    const cf = makeClient({ apiToken: TOKEN, timeoutMs: 200 });
    await cf.call(`/zones/${ZONE_ID}/dns_records`, 'POST', { type: 'A' });
    await cf.call(`/zones/${ZONE_ID}/dns_records/${REC_ID}`, 'PATCH', { content: VPS_IP });
    assert.equal(m.writes().length, 2, 'the guard blocks bulk writes without blocking legitimate ones');
    assert.equal(m.calls()[0].url, `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records`);
  } finally { global.fetch = orig; }
});

// ---------------------------------------------------------------------------
// configureDns — the /sc-all-facing wrapper, same never-throws contract
// ---------------------------------------------------------------------------

test('configureDns (SCF-4): no token -> { skipped:true } with no fetch attempted', async () => {
  const orig = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('unreachable'); };
  try {
    const res = await configureDns({ fullDomain: SUB, dokployApiUrl: 'https://panel.example.com' });
    assert.equal(res.skipped, true);
    assert.match(res.reason, /no token or no fullDomain/);
    assert.equal(calls, 0, 'the arg guard runs before anything else');
  } finally { global.fetch = orig; }
});

test('configureDns (SCF-3): a malformed dokployApiUrl comes back as a reason, never a throw', async () => {
  const orig = global.fetch;
  global.fetch = async () => { throw new Error('unreachable'); };
  try {
    // dokployApiUrl is deliberately outside the arg guard: `new URL()` throws inside the try
    // and the never-throws contract turns it into a status object.
    const res = await configureDns({ fullDomain: SUB, dokployApiUrl: 'not a url', cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true, 'a bad control-plane URL is reported, not thrown');
    assert.match(res.reason, /Invalid URL/);
  } finally { global.fetch = orig; }
});

// ---------------------------------------------------------------------------
// SCF-14..SCF-19 — the properties the confirmed fixes added
// ---------------------------------------------------------------------------

test('configureDnsRecord (SCF-14): a requested TTL change is applied, not reported as a no-op', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // Content and proxied already match; only the TTL differs. Dropping the TTL ahead of a
    // planned IP change is a normal pre-cutover step — reporting success without applying it
    // means the operator cuts over believing propagation is 120s when it is still 3600s.
    if (isRecordList(url)) return cfOk([{ id: REC_ID, type: 'A', name: SUB, content: VPS_IP, proxied: false, ttl: 3600 }]);
    if ((init.method || 'GET') === 'PATCH') return cfOk({ id: REC_ID, ttl: 120 });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ttl: 120, ...FAST });
    assert.equal(res.alreadyExists, undefined, 'a record with the wrong TTL is not "already correct"');
    assert.equal(res.updated, true);
    const writes = m.writes();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].method, 'PATCH');
    assert.equal(writes[0].body.ttl, 120, 'the requested TTL actually reaches the wire');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-14): a matching TTL still writes nothing — no PATCH-every-run churn', async () => {
  const orig = global.fetch;
  const m = mockFetch((url) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    // Cloudflare forces ttl:1 on a proxied record, and normalizeProxy sends ttl:1 for one too,
    // so the two agree and an idempotent run stays idempotent.
    if (isRecordList(url)) return cfOk([{ id: REC_ID, type: 'A', name: SUB, content: VPS_IP, proxied: true, ttl: 1 }]);
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({
      fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, proxied: true, ttl: 300, ...FAST,
    });
    assert.equal(res.alreadyExists, true, 'a proxied record compares equal on the ttl:1 Cloudflare forces');
    assert.equal(m.writes().length, 0, 'including ttl in the check must not cause a rewrite on every run');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-15): a hostname passed as an A target is refused with ZERO requests', async () => {
  const orig = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('a malformed target must never reach the network'); };
  try {
    // The CLI's `set` has no target validation of its own, so this typo arrives here intact.
    // Refusing before the zone lookup is what keeps it from costing the CNAME that the clash
    // path would otherwise have deleted to make room for a create that cannot succeed.
    const res = await configureDnsRecord({
      fullDomain: 'www.antinrml.com', type: 'A', target: 'shops.myshopify.com', cloudflareToken: TOKEN, ...FAST,
    });
    assert.equal(res.skipped, true, 'pure refusal — nothing was written');
    assert.match(res.reason, /not a valid A target/, 'the reason names the shape problem, not a Cloudflare code');
    assert.equal(res.destroyed, undefined, 'nothing was destroyed either');
    assert.equal(calls, 0, 'validation runs before the zone lookup, so a bad target costs no API call');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-15): a valid AAAA and CNAME target still pass the shape check', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) return cfOk([]);
    if ((init.method || 'GET') === 'POST') return cfOk({ id: REC_ID });
    return null;
  });
  global.fetch = m.fetch;
  try {
    const v6 = await configureDnsRecord({ fullDomain: SUB, type: 'AAAA', target: '2606:4700:4700::1111', cloudflareToken: TOKEN, ...FAST });
    assert.equal(v6.created, true, 'a real IPv6 address is not rejected by the AAAA guard');
    const cn = await configureDnsRecord({ fullDomain: SUB, type: 'CNAME', target: 'cname.vercel-dns.com', cloudflareToken: TOKEN, ...FAST });
    assert.equal(cn.created, true, 'a real hostname is not rejected by the CNAME guard');
    const txt = await configureDnsRecord({ fullDomain: SUB, type: 'TXT', target: 'v=spf1 -all', cloudflareToken: TOKEN, ...FAST });
    assert.equal(txt.created, true, 'TXT content is arbitrary free text and is never shape-checked');
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-16): a failed create after a clash DELETE restores the record and says so', async () => {
  const orig = global.fetch;
  const CNAME_ID = 'recclash000000000000000000clash';
  const posts = [];
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) {
      const type = qs(url).get('type');
      if (type === 'CNAME') return cfOk([{ id: CNAME_ID, type: 'CNAME', name: SUB, content: 'cname.vercel-dns.com', ttl: 1, proxied: false }]);
      return cfOk([]);
    }
    const method = init.method || 'GET';
    if (method === 'DELETE') return cfOk({ id: CNAME_ID });
    if (method === 'POST') {
      posts.push(JSON.parse(init.body));
      // The first POST is the replacement and it fails — 429 is reachable for real, since
      // /sc-all writes api-/site-/dash- plus the frontend in one burst. The second POST is
      // the restore and must be allowed through.
      if (posts.length === 1) return cfErr(429, 971, 'rate limited');
      return cfOk({ id: 'recrestored00000000000000000res' });
    }
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true, 'the record asked for is not in place, so skipped stays true (dns.js exits non-zero)');
    assert.equal(res.destroyed, true, 'and the caller is TOLD a pre-existing record was removed');
    assert.equal(res.restored, true, 'the best-effort re-create put it back');
    assert.match(res.reason, /971/, 'the underlying Cloudflare failure survives in the reason');
    assert.equal(res.priorRecord.type, 'CNAME', 'the snapshot carries enough to re-create it by hand');
    assert.equal(res.priorRecord.content, 'cname.vercel-dns.com');
    assert.deepEqual(res.priorRecords, [res.priorRecord]);

    assert.deepEqual(m.writes().map(c => c.method), ['DELETE', 'POST', 'POST'], 'delete, failed create, restore');
    assert.equal(posts[1].type, 'CNAME', 'the restore re-creates the exact record that was removed');
    assert.equal(posts[1].content, 'cname.vercel-dns.com');
    assert.equal(posts[1].name, SUB);
  } finally { global.fetch = orig; }
});

test('configureDnsRecord (SCF-17): a restore that itself fails reports restored:false and never throws', async () => {
  const orig = global.fetch;
  const origWarn = console.warn;
  console.warn = () => {};
  const CNAME_ID = 'recclash000000000000000000clash';
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) {
      const type = qs(url).get('type');
      if (type === 'CNAME') return cfOk([{ id: CNAME_ID, type: 'CNAME', name: SUB, content: 'old.example.com', ttl: 1 }]);
      return cfOk([]);
    }
    const method = init.method || 'GET';
    if (method === 'DELETE') return cfOk({ id: CNAME_ID });
    if (method === 'POST') return cfErr(500, 1000, 'internal error'); // both the create and the restore fail
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true);
    assert.equal(res.destroyed, true);
    assert.equal(res.restored, false, 'a failed restore is reported, never swallowed');
    assert.equal(res.priorRecords.length, 1, 'the operator still gets what they need to re-create it');
  } finally {
    console.warn = origWarn;
    global.fetch = orig;
  }
});

test('configureDnsRecord (SCF-16): a create that fails with NO clash deleted carries no destroyed flag', async () => {
  const orig = global.fetch;
  const m = mockFetch((url, init) => {
    if (isZoneProbe(url)) return zoneProbe(url);
    if (isRecordList(url)) return cfOk([]);          // nothing to clash with
    if ((init.method || 'GET') === 'POST') return cfErr(429, 971, 'rate limited');
    return null;
  });
  global.fetch = m.fetch;
  try {
    const res = await configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, cloudflareToken: TOKEN, ...FAST });
    assert.equal(res.skipped, true);
    assert.equal(res.destroyed, undefined, 'nothing was removed, so destroyed must NOT be set');
    assert.equal(m.writes().filter(c => c.method === 'DELETE').length, 0);
  } finally { global.fetch = orig; }
});

test('listRecords (SCF-18): the unfiltered listing pages — a record past row 100 is not invisible', async () => {
  const orig = global.fetch;
  const page1 = [];
  for (let i = 0; i < 100; i++) page1.push({ id: `rec_${i}`, type: 'TXT', name: `t${i}.${ZONE}`, content: 'x' });
  const m = mockFetch((url) => {
    if (!isRecordList(url)) return null;
    const page = Number(qs(url).get('page'));
    const info = { page, per_page: 100, total_count: 101, total_pages: 2 };
    if (page === 1) return cfOk(page1, info);
    // The record the operator is actually looking for — the live apex A. A single
    // ?per_page=100 read would report it "not found in zone" for a record that plainly exists.
    if (page === 2) return cfOk([{ id: APEX_REC_ID, type: 'A', name: ZONE, content: APEX_A_CONTENT }], info);
    return cfOk([], info);
  });
  global.fetch = m.fetch;
  try {
    const recs = await listRecords({ zoneId: ZONE_ID, cloudflareToken: TOKEN, timeoutMs: 200 });
    assert.equal(recs.length, 101, 'both pages are returned, not a silently truncated first page');
    assert.ok(recs.some(r => r.id === APEX_REC_ID), 'the record on page 2 is visible');
    const pages = m.calls().map(c => qs(c.url).get('page'));
    assert.deepEqual(pages, ['1', '2'], 'the walk stops at total_pages rather than spinning');
    assert.equal(m.writes().length, 0, 'listing is GET-only — the per-record write guard is not involved');
  } finally { global.fetch = orig; }
});

test('listRecords (SCF-18): an exact name+type lookup stays a SINGLE request', async () => {
  const orig = global.fetch;
  const m = mockFetch(() => cfOk([{ id: REC_ID, type: 'A', name: SUB, content: VPS_IP }]));
  global.fetch = m.fetch;
  try {
    // The write path takes this branch. It is bounded by construction, and adding a page loop
    // to it would change configureDnsRecord's request pattern for no benefit.
    await listRecords({ zoneId: ZONE_ID, name: SUB, type: 'A', cloudflareToken: TOKEN, timeoutMs: 200 });
    assert.equal(m.calls().length, 1, 'name+type is one exact-filter request, unpaged');
    assert.ok(m.calls()[0].url.includes('name.exact='), 'and it uses name.exact, never a loose name=');
  } finally { global.fetch = orig; }
});

test('makeClient (SCF-19): configureDns* keep the never-throws contract when the token is missing', async () => {
  const orig = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; throw new Error('unreachable'); };
  try {
    const cf = makeClient({ timeoutMs: 200 }); // no token anywhere, env cleared for this file
    // Going through the client must not behave differently from the bare export. A synchronous
    // throw here would also fire before a promise-style caller's .catch() could attach.
    const a = await cf.configureDnsRecord({ fullDomain: SUB, type: 'A', target: VPS_IP, ...FAST });
    assert.equal(a.skipped, true, 'the same status object the bare export returns');
    assert.match(a.reason, /missing token/);
    const b = await cf.configureDns({ fullDomain: SUB, dokployApiUrl: 'https://panel.example.com', ...FAST });
    assert.equal(b.skipped, true);
    assert.match(b.reason, /no token or no fullDomain/);
    assert.equal(calls, 0);

    // The low-level per-record surface is deliberately the opposite: it throws loudly, and
    // SYNCHRONOUSLY (the token is resolved while the argument object is built) — which is
    // exactly why the two configureDns* methods above must not share that wrapper.
    assert.throws(() => cf.listRecords({ zoneId: ZONE_ID }), /needs CLOUDFLARE_API_TOKEN/);
  } finally { global.fetch = orig; }
});
