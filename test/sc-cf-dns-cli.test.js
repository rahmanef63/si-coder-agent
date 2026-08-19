'use strict';

// skills/sc-cf/scripts/dns.js coverage — the policy checks that live in the CLI rather than
// in lib/cloudflare.js. The library's job is "one record, never the zone"; the CLI's job is
// "and not THAT record". This file exercises the second one end to end, by running the real
// script in a child process with `global.fetch` replaced by a preloaded stub.
//
//  SCC-1 `delete` refuses the zone apex without --allow-apex — INCLUDING when the zone is
//        pinned via CLOUDFLARE_ZONE_ID. resolveZone's pin path returns zoneName: null, so a
//        guard derived from zoneName alone is silently dead in exactly the least-privilege
//        token configuration this skill documents and recommends.
//  SCC-2 the same command without the pin is refused too — the guard is not pin-specific.
//  SCC-3 a NON-apex record still deletes cleanly under a pin: the fix must not be blanket-deny.
//  SCC-4 --allow-apex is still the documented escape hatch, under a pin as well.
//  SCC-5 `create` still warns when the name resolves to the apex under a pin.
//
// The zone fixture mirrors the real antinrml.com: its apex A points at a live Shopify
// storefront (23.227.38.65). Every assertion below is ultimately about that one row.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../skills/sc-cf/scripts/dns.js');

const ZONE = 'antinrml.com';
const ZONE_ID = 'zonepinned00000000000000000pin';
const APEX_ID = 'recapex00000000000000000000apex';
const SUB_ID = 'recsub0000000000000000000000sub';
const TOKEN = 'cf_test_token_never_printed_0123456789';

// A preload module that replaces global.fetch before dns.js runs. It serves a two-record zone
// and prints one `WIRE <METHOD> <path>` line per request, which is what the assertions read —
// the interesting property is which requests are NOT made.
const STUB = `
const ZONE = ${JSON.stringify(ZONE)};
const ZONE_ID = ${JSON.stringify(ZONE_ID)};
const RECORDS = [
  { id: ${JSON.stringify(APEX_ID)}, type: 'A', name: ZONE, content: '23.227.38.65', ttl: 1, proxied: false },
  { id: ${JSON.stringify(SUB_ID)}, type: 'A', name: 'be.' + ZONE, content: '203.0.113.10', ttl: 1, proxied: false },
];
const ok = (result, resultInfo) => ({ success: true, errors: [], messages: [], result, result_info: resultInfo });
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method || 'GET';
  console.log('WIRE ' + method + ' ' + u.pathname);
  let body;
  if (u.pathname === '/client/v4/zones') {
    const name = u.searchParams.get('name');
    body = ok(name === ZONE ? [{ id: ZONE_ID, name: ZONE }] : []);
  } else if (/\\/dns_records$/.test(u.pathname)) {
    body = method === 'POST'
      ? ok({ id: 'recnew0000000000000000000000new' })
      : ok(RECORDS, { page: 1, per_page: 100, count: RECORDS.length, total_count: RECORDS.length, total_pages: 1 });
  } else if (/\\/dns_records\\/[^/]+$/.test(u.pathname)) {
    body = ok({ id: u.pathname.split('/').pop() });
  } else {
    body = ok([]);
  }
  const text = JSON.stringify(body);
  return { ok: true, status: 200, text: async () => text };
};
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-cf-cli-'));
const STUB_PATH = path.join(tmp, 'fetch-stub.js');
fs.writeFileSync(STUB_PATH, STUB);
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

// Run the real CLI. `env` is built from scratch rather than inherited so a developer with
// CLOUDFLARE_ZONE_ID exported in their shell cannot change which branch is under test.
function runCli(argv, { pin = false } = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, CLOUDFLARE_API_TOKEN: TOKEN };
  if (pin) env.CLOUDFLARE_ZONE_ID = ZONE_ID;
  const r = spawnSync(process.execPath, ['--require', STUB_PATH, CLI, ...argv], {
    env, encoding: 'utf8', timeout: 20000,
  });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  return {
    code: r.status,
    out,
    wire: (r.stdout || '').split('\n').filter(l => l.startsWith('WIRE ')).map(l => l.slice(5)),
    deletes: (r.stdout || '').split('\n').filter(l => l.startsWith('WIRE DELETE ')),
  };
}

test('dns.js delete (SCC-1): the apex guard fires even when CLOUDFLARE_ZONE_ID pins the zone', () => {
  // The pin is the documented remedy for the dashboard's "Edit zone DNS" token template,
  // which grants Zone:DNS:Edit but not Zone:Read — so it is the NORMAL least-privilege setup.
  // resolveZone returns zoneName: null there, and a guard written as
  // `z.zoneName && target.name === ...` evaluates to null and never fires. This asserts the
  // guard derives the root from --zone instead, so a pasted-wrong id cannot take the bare
  // domain (and the live Shopify storefront behind it) offline.
  const r = runCli(['delete', '--zone', ZONE, '--record-id', APEX_ID, '--yes'], { pin: true });
  assert.equal(r.code, 1, 'the command is refused');
  assert.match(r.out, /ZONE APEX/, 'and says why, naming the apex');
  assert.deepEqual(r.deletes, [], 'not one DELETE reached the wire');
  assert.ok(!r.out.includes(TOKEN), 'the token value is never printed');
});

test('dns.js delete (SCC-2): the apex guard fires without a pin too', () => {
  const r = runCli(['delete', '--zone', ZONE, '--record-id', APEX_ID, '--yes'], { pin: false });
  assert.equal(r.code, 1);
  assert.match(r.out, /ZONE APEX/);
  assert.deepEqual(r.deletes, [], 'no DELETE on the unpinned path either');
});

test('dns.js delete (SCC-3): a NON-apex record still deletes under a pin — not blanket-deny', () => {
  // The guard must stay a targeted refusal. If deriving the root from --zone made every
  // delete fail, the fix would have traded a data-loss bug for an unusable command.
  const r = runCli(['delete', '--zone', ZONE, '--record-id', SUB_ID, '--yes'], { pin: true });
  assert.equal(r.code, 0, 'a subdomain record is deletable as before');
  assert.equal(r.deletes.length, 1, 'exactly one DELETE');
  assert.ok(r.deletes[0].endsWith(`/dns_records/${SUB_ID}`), 'and it names the id the operator asked for');
  assert.ok(!r.deletes[0].includes(APEX_ID), 'the apex id is never a delete target');
});

test('dns.js delete (SCC-4): --allow-apex remains the explicit escape hatch under a pin', () => {
  const r = runCli(['delete', '--zone', ZONE, '--record-id', APEX_ID, '--yes', '--allow-apex'], { pin: true });
  assert.equal(r.code, 0, 'an operator who genuinely means it can still proceed');
  assert.equal(r.deletes.length, 1);
  assert.ok(r.deletes[0].endsWith(`/dns_records/${APEX_ID}`));
});

test('dns.js delete (SCC-2): without --yes it stays a dry run and writes nothing', () => {
  const r = runCli(['delete', '--zone', ZONE, '--record-id', SUB_ID], { pin: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /dry run/);
  assert.deepEqual(r.deletes, [], 'delete is the only irreversible command and is opt-in');
});

test('dns.js create (SCC-5): the apex warning still prints when the zone is pinned', () => {
  // Same null zoneName, same forgotten fallback. Creating at the apex is legitimate, so this
  // stays a warning rather than a refusal — but it must not be silent.
  const r = runCli(['create', '--zone', ZONE, '--type', 'A', '--name', '@', '--content', '198.51.100.7'], { pin: true });
  assert.equal(r.code, 0, 'creating at the apex is allowed');
  assert.match(r.out, /ZONE APEX/, 'but the operator is told what they are pointing at');
  assert.ok(r.wire.some(l => l.startsWith('POST ')), 'the create still goes through');
});

test('dns.js create (SCC-5): a hostname passed as an A --content is refused before any request', () => {
  const r = runCli(['create', '--zone', ZONE, '--type', 'A', '--name', 'be', '--content', 'shops.myshopify.com'], { pin: true });
  assert.equal(r.code, 1);
  assert.match(r.out, /dotted-quad IPv4/, 'the failure names the actual problem, not a Cloudflare code');
  assert.deepEqual(r.wire, [], 'validation runs before the zone lookup, so it costs no API call');
});
