// lib/cloudflare.js — Cloudflare DNS automation (per-record A/AAAA/CNAME/TXT sync)
//
// WHY THIS FILE EXISTS SEPARATELY FROM lib/hostinger.js
// -----------------------------------------------------
// Hostinger's DNS API is zone-shaped: GET the whole zone as an array, mutate the array in
// memory, PUT the WHOLE array back. That is destructive by design — a single bug anywhere
// between the GET and the PUT (a bad filter, a truncated response, a mis-parsed body) writes
// a zone that is missing every record it failed to carry forward. The blast radius of any
// mistake is the entire domain.
//
// Cloudflare's API is per-record, and this module uses ONLY the per-record endpoints:
//     GET    /zones/{zone_id}/dns_records?type=&name.exact=     find
//     POST   /zones/{zone_id}/dns_records                       create
//     PATCH  /zones/{zone_id}/dns_records/{dns_record_id}        update one
//     DELETE /zones/{zone_id}/dns_records/{dns_record_id}        remove one
// The blast radius of a bug is therefore one record, not one zone. To keep it that way the
// guard in assertPerRecordWrite() runs before every non-GET and refuses, in code, to emit a
// request to a collection-level or bulk endpoint (/batch, /import, /scan, or a PUT to the
// record collection). A comment is not a control; the guard is.
//
// Two further rules follow from the same reasoning:
//   - A record id is only ever taken from a `name.exact` + `type` filtered lookup whose
//     result is then RE-VERIFIED client-side (rec.name === fqdn && rec.type === type). Some
//     Cloudflare API versions treat a bare `name=` as a contains-filter; trusting the server
//     filter alone is exactly how a request meant for `be.example.com` ends up PATCHing the
//     apex `example.com`.
//   - More than one match on name+type is a refusal, not a guess. Round-robin A records are
//     legal, and silently rewriting one of N is a surprise nobody asked for.
//
// WHY `proxied` DEFAULTS TO FALSE (grey cloud / "DNS-only")
// ---------------------------------------------------------
// The driving use case is a subdomain pointing at a VPS where Traefik must obtain a Let's
// Encrypt certificate. With proxied:true (orange cloud) Cloudflare publishes its own anycast
// IPs and terminates TLS at its edge, which breaks that in three separate ways:
//   1. The ACME HTTP-01 challenge for /.well-known/acme-challenge/<token> reaches Cloudflare's
//      edge, never Traefik on the origin — Cloudflare has no idea the token exists.
//   2. Cloudflare then fetches the origin over HTTPS (SSL mode Full/Full strict), but Traefik
//      has no certificate yet — because it is in the middle of trying to obtain one. The
//      origin fetch fails with 525/526 and the challenge fails. That is a deadlock, not a
//      race: it never resolves by retrying.
//   3. TLS-ALPN-01, Traefik's other default challenge, fails unconditionally — the handshake
//      is terminated at the edge and the ALPN negotiation never reaches the origin.
// Independently of TLS, Cloudflare's proxy applies idle timeouts and buffering to proxied
// connections, which degrades the long-lived websocket/long-poll transport a self-hosted
// Convex backend relies on.
// So `proxied` is FALSE unless the caller passes literal `true` — the check is `=== true`,
// never `??` or `!!`, because the string "false" out of a config file or a CLI flag is truthy
// and must not be able to silently turn the proxy on. Opting in also requires switching
// Traefik to the DNS-01 challenge, which validates via TXT and never touches port 80.

const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);

const CF_API = 'https://api.cloudflare.com/client/v4';

// Bound every Cloudflare API call so a hung connection can't stall a zero-human run.
// Mirrors the AbortController pattern in lib/hostinger.js / lib/vercel.js.
const CLOUDFLARE_TIMEOUT_MS = 15000;
// Give the record time to reach Cloudflare's edge resolvers before a caller (Traefik/ACME)
// asks for it. Matches the Hostinger twin's post-write settle so the existing fake-timer
// test helper drives both; exposed as `settleMs` so tests can pass 0.
const DNS_SETTLE_MS = 5000;
// Hard cap on zone enumeration: a misreported total_pages must not be able to spin forever
// inside a function whose whole contract is "never throws, always returns".
const MAX_ZONE_PAGES = 20;
const ZONES_PER_PAGE = 50;
// Same cap, same reason, for the record listing: a misreported total_pages must not be able
// to spin, and an unpaginated record read silently truncates (see listRecords).
const MAX_RECORD_PAGES = 20;
const RECORDS_PER_PAGE = 100;

// SCV-1 (borrowed verbatim from lib/vercel.js): never hand the DNS writer a non-IPv4 A
// target. Octets are range-checked (0-255) so a CNAME-shaped or out-of-range string is
// rejected before it becomes a broken record.
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
// Coarse shape checks for the other two targets configureDnsRecord can be asked to write.
// They exist to keep an obviously-wrong target from reaching a destructive code path, not to
// re-implement the resolver: AAAA must be hex-and-colons and actually contain a colon, and a
// CNAME target must look like a hostname (dot-separated labels, no scheme/slash/space/colon).
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const HOSTNAME_RE = /^(?=.{1,253}$)[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?(?:\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)+\.?$/;

// Refuse a target whose shape cannot possibly be valid for the record type. Returns a reason
// string, or null when the target is acceptable. TXT is deliberately unchecked — its content
// is arbitrary free text (SPF, DKIM, ACME tokens) and there is no shape to assert.
// WHY THIS MATTERS MORE THAN A NICER ERROR MESSAGE: configureDnsRecord may DELETE a clashing
// A/AAAA/CNAME before it creates the replacement. If the replacement is rejected by the API,
// the name is left with no record at all. Validating first means a malformed target costs an
// argument check instead of a live record.
function badTargetReason(recType, target) {
  const t = String(target == null ? '' : target).trim();
  if (recType === 'A' && !IPV4_RE.test(t)) return `'${target}' is not a valid A target (expected a dotted-quad IPv4)`;
  if (recType === 'AAAA' && !(t.includes(':') && IPV6_RE.test(t))) return `'${target}' is not a valid AAAA target (expected an IPv6 address)`;
  if (recType === 'CNAME' && !HOSTNAME_RE.test(t)) return `'${target}' is not a valid CNAME target (expected a hostname)`;
  return null;
}

// Only A, AAAA and CNAME can carry Cloudflare's proxy. MX/TXT/etc. are always DNS-only, so a
// stray proxied:true on those is dropped rather than sent (Cloudflare would reject it).
const PROXIABLE_TYPES = new Set(['A', 'AAAA', 'CNAME']);

// Cloudflare error codes worth branching on. Everything else is surfaced verbatim.
const CF_ERR = {
  RECORD_EXISTS: 81057,   // POST raced another writer — this is the idempotency signal
  HOST_CONFLICT: 81053,   // an A/AAAA/CNAME already occupies that host
  RECORD_MISSING: 81044,  // PATCH/DELETE against a stale id
  NO_ROUTE: 7003,         // "Could not route to <path>" — means OUR zoneId/recordId was empty
};

// Keep the abort timer armed across the body read: a backend that sends headers then
// stalls the body would otherwise hang forever (the signal must still cover .text()).
// Returns a thin envelope {ok,status,text,json()} with the body already consumed under
// the live signal, so callers never read a body outside the timeout window.
async function fetchWithTimeout(url, init = {}, timeoutMs = CLOUDFLARE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    // Consume the body here, while the signal is still live, so a backend that sends
    // headers then stalls the body is bounded by the same timeout (not just connect).
    // Real fetch Responses expose .text(); read once and parse JSON lazily from it.
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, json: () => JSON.parse(text) };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Cloudflare timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Secrets come from the environment only: argv is world-readable via `ps` and
// /proc/<pid>/cmdline, so a token passed as a CLI argument leaks to every user on the box.
// `.trim()` is not cosmetic — a token pasted into ~/.bashrc keeps its trailing newline and
// Cloudflare answers 6111 "Invalid format for Authorization header", which reads like a bad
// token rather than a stray byte.
function resolveToken(explicit) {
  const t = explicit || process.env.CLOUDFLARE_API_TOKEN || '';
  return String(t).trim();
}

// The token is never logged, not even a preview: it grants DNS write on a live zone and has
// no diagnostic value in a log line. Errors below carry Cloudflare's own code/message only.
const cfHeaders = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

// Cap error text so a multi-megabyte edge error page can't flood a log (mirrors the
// text.slice(0, 300) in scripts/hostinger-dns.js).
const snip = (s) => String(s == null ? '' : s).slice(0, 300);

const recordsUrl = (zoneId) => `${CF_API}/zones/${encodeURIComponent(zoneId)}/dns_records`;
const recordUrl = (zoneId, recordId) => {
  // A falsy id would degenerate the path to /dns_records/undefined or /dns_records/ and
  // Cloudflare answers 7003 — which looks like a user config problem but is always our bug.
  // Refusing here keeps that class of mistake off the wire entirely.
  if (!zoneId || !recordId) throw new Error('recordUrl: zoneId and recordId are required');
  return `${recordsUrl(zoneId)}/${encodeURIComponent(recordId)}`;
};
// `name.exact` is dot-notation on purpose: a bare `name=` is not in the current schema and
// behaves as a loose contains-filter on some API versions.
const findRecordUrl = (zoneId, type, fqdn) =>
  `${recordsUrl(zoneId)}?type=${encodeURIComponent(type)}&name.exact=${encodeURIComponent(fqdn)}`;

// ---------------------------------------------------------------------------
// The safety guard: structurally refuse any write that is not per-record.
// ---------------------------------------------------------------------------
const PER_RECORD_PATH = /^\/zones\/[^/?#]+\/dns_records(?:\/[^/?#]+)?$/;
// These are real Cloudflare endpoints that write many records at once. They are the exact
// shape of the Hostinger whole-zone PUT this module exists to avoid, so they are unreachable
// by construction rather than merely unused.
const BULK_SEGMENTS = new Set(['batch', 'import', 'export', 'scan']);
// CF_API carries a path prefix ('/client/v4'), so the guard must compare the endpoint part
// only — matching the raw pathname would reject every legitimate write.
const CF_API_PATH = new URL(CF_API).pathname.replace(/\/$/, '');

function assertPerRecordWrite(method, url) {
  const { pathname } = new URL(url);
  const path = pathname.startsWith(CF_API_PATH) ? pathname.slice(CF_API_PATH.length) : pathname;
  if (!PER_RECORD_PATH.test(path)) {
    throw new Error(`refusing ${method} to a non per-record path: ${path}`);
  }
  const segments = path.split('/'); // ['', 'zones', id, 'dns_records'(, recordId)]
  const tail = segments[segments.length - 1];
  if (BULK_SEGMENTS.has(tail)) {
    throw new Error(`refusing ${method} to bulk endpoint: ${path}`);
  }
  const hasRecordId = segments.length === 5;
  // PUT is "Overwrite DNS Record": fields omitted from the body revert to DEFAULTS rather
  // than keeping their current value, so a content-only PUT can silently flip an
  // intentionally grey-cloud record to proxied and drop its comment/tags. PATCH preserves.
  if (method === 'PUT') throw new Error('refusing PUT: use PATCH so omitted fields are preserved');
  if (method === 'POST' && hasRecordId) {
    throw new Error(`refusing POST to a specific record: ${path}`);
  }
  if ((method === 'PATCH' || method === 'DELETE') && !hasRecordId) {
    throw new Error(`refusing ${method} to the record collection (that is a whole-zone write): ${path}`);
  }
}

// ---------------------------------------------------------------------------
// Response envelope. res.ok alone is NOT the success signal.
// ---------------------------------------------------------------------------
// Every v4 response is { success, errors: [{code, message}], messages, result, result_info }.
// Cloudflare can answer HTTP 200 with success:false, so both must be checked; and a 5xx from
// the edge is frequently an HTML page, hence the JSON.parse guard.
function cfUnwrap(res, label) {
  let body;
  try {
    body = res.json();
  } catch {
    return { ok: false, status: res.status, code: 0, reason: `${label} ${res.status}: non-JSON ${snip(res.text)}` };
  }
  if (body && body.success === true && (!Array.isArray(body.errors) || body.errors.length === 0)) {
    return { ok: true, status: res.status, result: body.result, resultInfo: body.result_info };
  }
  const err = (body && Array.isArray(body.errors) && body.errors[0]) || {};
  const code = err.code || 0;
  const message = snip(err.message || `HTTP ${res.status}`);
  return { ok: false, status: res.status, code, reason: `${label} ${res.status}: ${code} ${message}` };
}

// Single choke point for every request this module makes. Non-GETs pass the per-record guard
// first, so a bulk write cannot be issued even by a future edit that forgets why.
async function cfRequest(url, { method = 'GET', token, body = null, timeoutMs = CLOUDFLARE_TIMEOUT_MS, label = 'cloudflare' } = {}) {
  if (method !== 'GET') assertPerRecordWrite(method, url);
  const init = { method, headers: cfHeaders(token) };
  if (body) init.body = JSON.stringify(body);
  const res = await fetchWithTimeout(url, init, timeoutMs);
  return cfUnwrap(res, label);
}

// The thin helpers below throw on failure and tag the error with `cfCode`/`cfStatus`, the way
// lib/dokploy.js tags `err.isHttpError`. configureDnsRecord's catch turns those into a
// `reason` string; the CLI lets them reach main().catch. Callers that need to branch on a
// specific Cloudflare code (81057 on create) read `err.cfCode` rather than regexing a message.
function cfThrow(r) {
  const e = new Error(`Cloudflare ${r.reason}`);
  e.cfCode = r.code;
  e.cfStatus = r.status;
  return e;
}

// ---------------------------------------------------------------------------
// Zone resolution — longest matching suffix wins.
// ---------------------------------------------------------------------------
// 'x.sub.example.com' -> ['x.sub.example.com', 'sub.example.com', 'example.com'].
// Stops at two labels: a single label is a TLD/public suffix and can never be your zone.
// Probing longest-first means the FIRST hit is by construction the longest match, which is
// what makes a delegated subdomain zone (sub.example.com) beat its parent.
function zoneCandidates(fqdn) {
  const parts = fqdn.split('.');
  const out = [];
  for (let i = 0; i + 2 <= parts.length; i++) out.push(parts.slice(i).join('.'));
  return out;
}

// Suffix test must be dot-aligned, otherwise 'notexample.com' matches zone 'example.com'.
const isZoneSuffix = (fqdn, zoneName) => fqdn === zoneName || fqdn.endsWith(`.${zoneName}`);

// Walk GET /zones page by page. Needed when the token is account-scoped and the `?name=`
// filter yields nothing usable: an unpaginated GET /zones silently truncates at 20, so on an
// account with more zones than that the target simply would not appear and the module would
// report "not in account" for a zone that plainly exists.
async function listZonesPaged(token, timeoutMs) {
  const zones = [];
  for (let page = 1; page <= MAX_ZONE_PAGES; page++) {
    const url = `${CF_API}/zones?per_page=${ZONES_PER_PAGE}&page=${encodeURIComponent(page)}`;
    const r = await cfRequest(url, { token, timeoutMs, label: 'zones' });
    if (!r.ok) return { error: r.reason };
    const batch = Array.isArray(r.result) ? r.result : [];
    zones.push(...batch);
    const totalPages = r.resultInfo && r.resultInfo.total_pages;
    if (batch.length === 0) break;
    if (totalPages && page >= totalPages) break;
    if (!totalPages && batch.length < ZONES_PER_PAGE) break;
  }
  return { zones };
}

// Find which Cloudflare zone `fullDomain` lives in.
// Returns { zoneId, zoneName, recordName } or { error } — the { error: <string> } channel
// matches resolveRoot() in lib/hostinger.js so the caller's propagation line ports unchanged.
//
// recordName is the FULL FQDN, always — including for the apex, where the record name IS the
// zone name. Cloudflare names records by FQDN; passing Hostinger's '@' sentinel through would
// create a literal record called '@.example.com'. That is the single biggest translation trap
// between the two providers.
async function resolveZone(fullDomain, cloudflareToken, { timeoutMs = CLOUDFLARE_TIMEOUT_MS, zoneId } = {}) {
  const token = resolveToken(cloudflareToken);
  if (!token) return { error: 'missing token' };
  if (!fullDomain || typeof fullDomain !== 'string') return { error: 'missing fullDomain' };
  const fqdn = fullDomain.trim().replace(/\.$/, '').toLowerCase();
  if (!fqdn.includes('.')) return { error: `not a fully-qualified domain: '${fqdn}'` };

  // Escape hatch: the dashboard's "Edit zone DNS" token template grants Zone:DNS:Edit but NOT
  // Zone:Read, so GET /zones answers 200 success:true result:[] — an empty list, not a 403.
  // Supplying the zone id directly skips discovery entirely and lets that tighter, single-zone
  // token do every per-record operation it is otherwise perfectly entitled to.
  // A pin bypasses the only check that would catch it pointing at the wrong zone, so it is
  // announced rather than applied silently — an operator who left CLOUDFLARE_ZONE_ID exported
  // from a previous domain must be able to see which zone this write is actually landing in.
  const pinned = zoneId || process.env.CLOUDFLARE_ZONE_ID;
  if (pinned) {
    const zid = String(pinned).trim();
    console.log(`ℹ️ using pinned zone ${zid} for '${fqdn}' (zone lookup skipped)`);
    return { zoneId: zid, zoneName: null, recordName: fqdn };
  }

  // Targeted probe first: `?name=` is an exact match (the default filter operator is `equal`),
  // so this is at most a couple of tiny requests and needs no pagination at all.
  let probeErr = null;
  for (const cand of zoneCandidates(fqdn)) {
    const r = await cfRequest(`${CF_API}/zones?name=${encodeURIComponent(cand)}`, { token, timeoutMs, label: 'zones' });
    if (!r.ok) { probeErr = r.reason; break; }
    const hit = (Array.isArray(r.result) ? r.result : [])
      .find(z => z && z.id && typeof z.name === 'string' && z.name.toLowerCase() === cand);
    if (hit) return { zoneId: hit.id, zoneName: hit.name, recordName: fqdn };
  }

  // Fallback for an account-scoped token whose listing ignores the name filter: enumerate and
  // pick the longest matching suffix ourselves. A zone-name match is authoritative, so this
  // also sidesteps the multi-label public-suffix problem ('example.co.uk' is three labels but
  // still an apex) that any label-count heuristic gets wrong.
  const paged = await listZonesPaged(token, timeoutMs);
  if (paged.error) return { error: probeErr || paged.error };
  const match = paged.zones
    .filter(z => z && z.id && typeof z.name === 'string' && isZoneSuffix(fqdn, z.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (match) return { zoneId: match.id, zoneName: match.name, recordName: fqdn };

  if (probeErr) return { error: probeErr };
  // Name the likely cause: an empty result here is far more often a token-scope problem than
  // a genuinely absent zone, and that is the difference between a five-second fix and an hour.
  return { error: `root zone for '${fqdn}' not in account (token needs Zone:Read, or set CLOUDFLARE_ZONE_ID)` };
}

// ---------------------------------------------------------------------------
// Per-record helpers — the entire allowed write surface, and the CLI's building blocks.
// ---------------------------------------------------------------------------

// GET the records matching name+type exactly. The server-side filter is re-verified by every
// caller before the result is used to build a write URL; see the header comment.
async function listRecords({ zoneId, name, type, cloudflareToken, timeoutMs = CLOUDFLARE_TIMEOUT_MS } = {}) {
  const token = resolveToken(cloudflareToken);
  if (!token) throw new Error('Cloudflare listRecords: missing token');
  if (!zoneId) throw new Error('Cloudflare listRecords: missing zoneId');
  // Exact name+type lookup: bounded by construction (a handful of round-robin rows at most),
  // so it needs no pagination and the write path's single-request behaviour is unchanged.
  if (name && type) {
    const r = await cfRequest(findRecordUrl(zoneId, type, name), { token, timeoutMs, label: 'records' });
    if (!r.ok) throw cfThrow(r);
    return Array.isArray(r.result) ? r.result : [];
  }

  // Full listing: paged for the same reason listZonesPaged pages /zones. A single
  // ?per_page=100 silently truncates, and the CLI then reports a record that exists past row
  // 100 as "not found in zone" (dns.js delete) or omits it from `list` entirely.
  const records = [];
  for (let page = 1; page <= MAX_RECORD_PAGES; page++) {
    const url = `${recordsUrl(zoneId)}?per_page=${RECORDS_PER_PAGE}&page=${encodeURIComponent(page)}`;
    const r = await cfRequest(url, { token, timeoutMs, label: 'records' });
    if (!r.ok) throw cfThrow(r);
    const batch = Array.isArray(r.result) ? r.result : [];
    records.push(...batch);
    const totalPages = r.resultInfo && r.resultInfo.total_pages;
    if (batch.length === 0) break;
    if (totalPages && page >= totalPages) break;
    if (!totalPages && batch.length < RECORDS_PER_PAGE) break;
  }
  return records;
}

async function createRecord({ zoneId, name, type, content, ttl = 1, proxied = false, comment, cloudflareToken, timeoutMs = CLOUDFLARE_TIMEOUT_MS } = {}) {
  const token = resolveToken(cloudflareToken);
  if (!token) throw new Error('Cloudflare createRecord: missing token');
  if (!zoneId || !name || !type || !content) throw new Error('Cloudflare createRecord: missing zoneId/name/type/content');
  const body = { type, name, content, ...normalizeProxy(type, proxied, ttl) };
  if (comment) body.comment = comment;
  const r = await cfRequest(recordsUrl(zoneId), { method: 'POST', token, body, timeoutMs, label: 'POST' });
  if (!r.ok) throw cfThrow(r);
  return r.result;
}

// PATCH ("Edit"), never PUT ("Overwrite"): omitted fields are preserved rather than reset to
// defaults. We nonetheless send the full identifying set {type,name,content,ttl,proxied} so
// the request is unambiguous regardless of verb — belt and braces, since `proxied` reverting
// to a zone default is precisely the silent regression this module must not produce.
async function updateRecord({ zoneId, recordId, name, type, content, ttl = 1, proxied = false, cloudflareToken, timeoutMs = CLOUDFLARE_TIMEOUT_MS } = {}) {
  const token = resolveToken(cloudflareToken);
  if (!token) throw new Error('Cloudflare updateRecord: missing token');
  if (!recordId) throw new Error('Cloudflare updateRecord: missing recordId');
  const body = { type, name, content, ...normalizeProxy(type, proxied, ttl) };
  const r = await cfRequest(recordUrl(zoneId, recordId), { method: 'PATCH', token, body, timeoutMs, label: 'PATCH' });
  if (!r.ok) throw cfThrow(r);
  return r.result;
}

async function deleteRecord({ zoneId, recordId, cloudflareToken, timeoutMs = CLOUDFLARE_TIMEOUT_MS } = {}) {
  const token = resolveToken(cloudflareToken);
  if (!token) throw new Error('Cloudflare deleteRecord: missing token');
  if (!recordId) throw new Error('Cloudflare deleteRecord: missing recordId');
  const r = await cfRequest(recordUrl(zoneId, recordId), { method: 'DELETE', token, timeoutMs, label: 'DELETE' });
  // Deleting an id that is already gone is the state the caller asked for, not a failure.
  if (!r.ok && r.code === CF_ERR.RECORD_MISSING) return { id: recordId, alreadyGone: true };
  if (!r.ok) throw cfThrow(r);
  return r.result;
}

// `proxied` and `ttl` are coupled by Cloudflare: a proxied record's TTL is forced to Auto and
// sending a numeric TTL alongside proxied:true is rejected. Resolving both together in one
// place keeps that coupling out of every call site.
function normalizeProxy(type, proxied, ttl) {
  // `=== true` and nothing looser: the string "false" is truthy, and a config-file or CLI
  // value must never be able to turn the proxy on by accident. See the header comment for
  // what an unintended orange cloud costs (no Let's Encrypt cert, broken Convex websockets).
  const on = proxied === true && PROXIABLE_TYPES.has(type);
  if (on) return { ttl: 1, proxied: true };
  // ttl 1 means "automatic" (300s). The only other legal band is 60-86400 on Free/Pro/
  // Business plans, so anything outside it falls back to automatic rather than being rejected
  // by the API after the fact.
  const t = Number(ttl);
  const safeTtl = t === 1 || (Number.isFinite(t) && t >= 60 && t <= 86400) ? t : 1;
  // proxied is sent EXPLICITLY, never merely omitted: the server-side default is not
  // guaranteed to be grey cloud, and "we didn't say" is not the same as "we said no".
  return { ttl: safeTtl, proxied: false };
}

// Trailing dots are equivalent in DNS and Cloudflare returns CNAME targets dot-terminated,
// so compare with the dot stripped. Hostnames are case-insensitive; IPv4 literals are
// unaffected by lowercasing, so one comparison covers both.
const sameContent = (a, b) =>
  String(a == null ? '' : a).replace(/\.$/, '').toLowerCase() ===
  String(b == null ? '' : b).replace(/\.$/, '').toLowerCase();

// ---------------------------------------------------------------------------
// CORE: idempotently ensure a single DNS record. type: 'A' | 'AAAA' | 'CNAME' | 'TXT'.
// Never throws — returns a status object (mirrors the lib/hostinger.js contract):
//   { skipped: true,  reason: <string> }                    the write did not land
//   { skipped: false, alreadyExists: true }                 already correct, nothing written
//   { skipped: false, created: true }                       a new record was created
//   { skipped: false, created: true, updated: true }        an existing record was PATCHed
// Consumers branch on `skipped` alone, so it is always present and always boolean; `created`
// stays set on the update path so no existing `.created` check regresses.
//
// `skipped: true` means the record this call was asked to ensure is NOT in place. It does NOT
// on its own promise the zone is untouched, because a clashing A/AAAA/CNAME has to be removed
// before the replacement can be created. When that replacement then fails, the result carries:
//   { skipped: true, destroyed: true, restored: <bool>, priorRecord, priorRecords, reason }
// `destroyed: true` says a pre-existing record was removed and the replacement did not land;
// `restored` says whether the best-effort re-create of `priorRecords` succeeded. These fields
// are additive — `skipped` stays true so every existing failure branch keeps working — and
// they exist so an operator (or a caller) can put back exactly what was taken away.
// ---------------------------------------------------------------------------
async function configureDnsRecord({
  fullDomain, type, target, cloudflareToken, apiToken,
  proxied = false, ttl = 1, zoneId,
  timeoutMs = CLOUDFLARE_TIMEOUT_MS, settleMs = DNS_SETTLE_MS,
  comment = 'managed by si-coder /sc-cf',
} = {}) {
  // `apiToken` is accepted as an alias so a call site written against either provider's
  // vocabulary works; both are still only ever populated from process.env upstream.
  const token = resolveToken(cloudflareToken || apiToken);
  if (!token || !fullDomain || !type || !target) {
    return { skipped: true, reason: 'missing token/fullDomain/type/target' };
  }
  const recType = String(type).toUpperCase();
  const wantProxied = proxied === true && PROXIABLE_TYPES.has(recType);
  // Validate the caller's target BEFORE anything destructive, and before the zone lookup so an
  // obviously bad target costs no API call at all. This is pure refusal: the clash path below
  // deletes an existing record to make room, and a target the API is certain to reject must
  // never be able to get that far. See badTargetReason().
  const badTarget = badTargetReason(recType, target);
  if (badTarget) {
    console.warn(`⚠️ ${badTarget}`);
    return { skipped: true, reason: badTarget };
  }
  // Resolve the desired ttl/proxied pair once, through the same helper the write path uses, so
  // the "already correct" test below compares against exactly what a write would send.
  const want = normalizeProxy(recType, wantProxied, ttl);
  try {
    console.log(`\n🌍 Cloudflare DNS: ensure ${recType} '${fullDomain}' -> ${target} (${wantProxied ? 'proxied' : 'DNS-only'})`);
    const r = await resolveZone(fullDomain, token, { timeoutMs, zoneId });
    if (r.error) { console.log(`⚠️ ${r.error}`); return { skipped: true, reason: r.error }; }
    const { zoneId: zid, zoneName, recordName } = r;

    const found = await listRecords({ zoneId: zid, name: recordName, type: recType, cloudflareToken: token, timeoutMs });
    // Re-verify the server-side filter client-side. A loose `name=` behaves as a contains
    // filter on some API versions, and that difference is exactly how a request for
    // 'be.example.com' would end up holding the apex record's id.
    const matches = found.filter(rr => rr && rr.name === recordName && rr.type === recType);
    if (matches.length > 1) {
      // Round-robin records are legal; picking one of N at random is not a decision this
      // module gets to make on a live zone.
      const reason = `ambiguous: ${matches.length} records match ${recType} ${recordName}`;
      console.warn(`⚠️ ${reason}`);
      return { skipped: true, reason };
    }

    if (matches.length === 1) {
      const existing = matches[0];
      // The proxied flag AND the ttl are part of "correct". A record left orange from an
      // earlier run keeps breaking cert issuance forever while a content-only check happily
      // reports alreadyExists — the failure would be invisible, which is the worst kind. TTL
      // is in the comparison for the same reason: lowering it ahead of a planned IP change is
      // a normal pre-cutover step, and reporting success without applying it means the
      // operator cuts over believing propagation is 60s when it is still the old value.
      // Compared against the NORMALIZED value, not the raw argument, so the predicate agrees
      // with what updateRecord/createRecord would actually send (both re-normalize).
      if (sameContent(existing.content, target)
        && Boolean(existing.proxied) === want.proxied
        && Number(existing.ttl) === want.ttl) {
        console.log(`✅ ${recType} record for ${fullDomain} already correct`);
        return { skipped: false, alreadyExists: true };
      }
      console.log(`📝 PATCH ${recType} '${recordName}' -> ${target} (record ${existing.id})...`);
      await updateRecord({
        zoneId: zid, recordId: existing.id, name: recordName, type: recType,
        content: target, ttl, proxied: wantProxied, cloudflareToken: token, timeoutMs,
      });
      console.log(`✅ Cloudflare DNS updated for ${fullDomain}`);
      if (settleMs > 0) await new Promise(res => setTimeout(res, settleMs));
      return { skipped: false, created: true, updated: true };
    }

    // A/AAAA and CNAME cannot coexist on the same name — Cloudflare rejects the create with
    // 81053. Remove the ONE clashing record, by an id that came from an exact name+type
    // lookup, and nothing else. TXT is explicitly excluded from this: TXT legitimately
    // coexists with anything (SPF/DKIM/ACME challenges live there) and must NEVER trigger a
    // delete. Same guard as lib/hostinger.js, minus the whole-zone splice.
    const clashTypes = recType === 'CNAME' ? ['A', 'AAAA']
      : (recType === 'A' || recType === 'AAAA') ? ['CNAME']
        : [];
    // Every record removed to make room is snapshotted first, so a failed create can put it
    // back. Without this, a rejected POST leaves the name resolving to NOTHING while the
    // return value reports a skip — the caller is told to treat a destroyed live record as a
    // clean no-op. The loop can delete more than one record (a CNAME target clashes with both
    // A and AAAA), so the snapshot is a list, not a single row.
    const removed = [];
    for (const clashType of clashTypes) {
      const clashes = (await listRecords({ zoneId: zid, name: recordName, type: clashType, cloudflareToken: token, timeoutMs }))
        .filter(rr => rr && rr.name === recordName && rr.type === clashType);
      if (clashes.length === 0) continue;
      if (clashes.length > 1) {
        const reason = `ambiguous clash: ${clashes.length} ${clashType} records on ${recordName}`;
        console.warn(`⚠️ ${reason}`);
        return { skipped: true, reason };
      }
      const doomed = clashes[0];
      console.log(`🧹 removing clashing ${clashType} '${recordName}' (${doomed.id}) before creating ${recType}`);
      removed.push({
        type: doomed.type, name: doomed.name, content: doomed.content,
        ttl: doomed.ttl, proxied: doomed.proxied === true,
        priority: doomed.priority, comment: doomed.comment,
      });
      await deleteRecord({ zoneId: zid, recordId: doomed.id, cloudflareToken: token, timeoutMs });
    }

    console.log(`📝 POST ${recType} '${recordName}' -> ${target} in zone ${zoneName || zid}...`);
    try {
      await createRecord({
        zoneId: zid, name: recordName, type: recType, content: target,
        ttl, proxied: wantProxied, comment, cloudflareToken: token, timeoutMs,
      });
    } catch (e) {
      // 81057 means another writer created the identical record between our lookup and our
      // POST. The end state is the one we asked for, so report it as such instead of failing
      // a deploy over a race we already won.
      if (e.cfCode === CF_ERR.RECORD_EXISTS) {
        console.log(`✅ ${recType} record for ${fullDomain} already exists (created concurrently)`);
        return { skipped: false, alreadyExists: true };
      }
      // The create failed after a clash was already deleted. That name now has no record at
      // all, so put the old one back — best effort, in its own try/catch, because a failing
      // restore must not throw out of a function whose contract is "never throws". Either way
      // the caller is TOLD, via destroyed/priorRecords, instead of reading a bare skip.
      if (removed.length > 0) {
        let restored = true;
        for (const snap of removed) {
          try {
            console.warn(`↩️ create failed — restoring the ${snap.type} '${snap.name}' that was removed for it`);
            await createRecord({
              zoneId: zid, name: snap.name, type: snap.type, content: snap.content,
              ttl: snap.ttl, proxied: snap.proxied, comment: snap.comment,
              cloudflareToken: token, timeoutMs,
            });
          } catch (restoreErr) {
            restored = false;
            console.warn(`⚠️ restore of ${snap.type} '${snap.name}' failed: ${restoreErr.message}`);
          }
        }
        console.warn(`⚠️ Cloudflare DNS error: ${e.message}`);
        if (!restored) {
          console.warn(`⚠️ ${recordName} may now have NO record — re-create it from priorRecords in the result.`);
        }
        return {
          skipped: true, destroyed: true, restored,
          priorRecord: removed[0], priorRecords: removed,
          reason: e.message,
        };
      }
      throw e;
    }
    console.log(`✅ Cloudflare DNS updated for ${fullDomain}`);
    // Let the record reach Cloudflare's resolvers before whatever asked for it (Traefik's
    // ACME challenge) starts querying — a failed HTTP-01 costs far more than five seconds.
    if (settleMs > 0) await new Promise(res => setTimeout(res, settleMs));
    return { skipped: false, created: true };
  } catch (e) {
    console.warn(`⚠️ Cloudflare DNS error: ${e.message}`);
    return { skipped: true, reason: e.message };
  }
}

// BACKWARD-COMPAT wrapper: A record pointing at the Dokploy server IP.
// Same shape as lib/hostinger.js configureDns so /sc-all can swap providers by swapping the
// require. The token defaults from the environment so the two call keys are identical.
async function configureDns({
  fullDomain, dokployApiUrl, cloudflareToken = process.env.CLOUDFLARE_API_TOKEN, apiToken,
  proxied = false, ttl = 1, zoneId, timeoutMs = CLOUDFLARE_TIMEOUT_MS, settleMs = DNS_SETTLE_MS,
} = {}) {
  const token = resolveToken(cloudflareToken || apiToken);
  if (!token || !fullDomain) {
    return { skipped: true, reason: 'no token or no fullDomain' };
  }
  try {
    // The Dokploy control plane and the workloads it schedules live on the same VPS, so the
    // panel's own hostname resolves to the IP every deployed app needs an A record for.
    // dokployApiUrl is deliberately NOT in the guard above: a missing or malformed URL throws
    // in here and comes back as { skipped: true, reason: 'Invalid URL' }, never as a throw.
    const apiHost = new URL(dokployApiUrl).hostname;
    // family:4 because a bare lookup() can return an IPv6 address, which would be written
    // into an A record and silently produce a domain that resolves to nothing usable.
    const { address: serverIp } = await lookup(apiHost, { family: 4 });
    if (!IPV4_RE.test(serverIp || '')) {
      const reason = `resolved ${apiHost} to a non-IPv4 address, refusing to write an A record`;
      console.warn(`⚠️ ${reason}`);
      return { skipped: true, reason };
    }
    return await configureDnsRecord({
      fullDomain, type: 'A', target: serverIp, cloudflareToken: token,
      proxied, ttl, zoneId, timeoutMs, settleMs,
    });
  } catch (e) {
    console.warn(`⚠️ Cloudflare DNS error: ${e.message}`);
    return { skipped: true, reason: e.message };
  }
}

// Generic client for the CLI and for the wider sc-cf surface. `call` mirrors lib/vercel.js
// makeClient().call, and routes through the same per-record write guard as everything else.
// The token is resolved per call so an env var exported after construction still works.
function makeClient({ apiToken, cloudflareToken, accountId, timeoutMs = CLOUDFLARE_TIMEOUT_MS } = {}) {
  const tokenOf = () => {
    const t = resolveToken(cloudflareToken || apiToken);
    if (!t) throw new Error('Cloudflare client needs CLOUDFLARE_API_TOKEN');
    return t;
  };

  async function call(endpoint, method = 'GET', body = null) {
    const url = `${CF_API}${endpoint}`;
    const r = await cfRequest(url, { method, token: tokenOf(), body, timeoutMs, label: `${method} ${endpoint}` });
    if (!r.ok) throw cfThrow(r);
    return r.result;
  }

  // Cheap preflight that separates "the token is expired/revoked" from "the token is fine but
  // its policy does not cover this zone" — otherwise both arrive as an opaque 403.
  const verifyToken = () => call('/user/tokens/verify');

  const withToken = (fn) => (args = {}) => fn({ timeoutMs, ...args, cloudflareToken: tokenOf() });

  // The never-throws contract has to survive the trip through the client. `withToken` calls
  // tokenOf() while the argument object is still being BUILT, so a missing token throws
  // synchronously — before the wrapped function is entered, and before any caller's .catch()
  // could attach. Resolving the token softly instead lets the missing-token case reach each
  // function's own guard and come back as the same { skipped: true, reason } the bare export
  // returns. Only the two DNS-configuring methods use this; the low-level per-record helpers
  // stay on tokenOf() because throwing loudly is their documented behaviour.
  const withSoftToken = (fn) => async (args = {}) =>
    fn({ timeoutMs, ...args, cloudflareToken: resolveToken(cloudflareToken || apiToken) });

  return {
    call,
    accountId,
    verifyToken,
    resolveZone: (fullDomain, opts = {}) => resolveZone(fullDomain, tokenOf(), { timeoutMs, ...opts }),
    listRecords: withToken(listRecords),
    createRecord: withToken(createRecord),
    updateRecord: withToken(updateRecord),
    deleteRecord: withToken(deleteRecord),
    configureDnsRecord: withSoftToken(configureDnsRecord),
    configureDns: withSoftToken(configureDns),
  };
}

module.exports = {
  makeClient,
  configureDns,
  configureDnsRecord,
  resolveZone,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
};
