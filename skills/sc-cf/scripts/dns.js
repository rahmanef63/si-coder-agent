#!/usr/bin/env node
// dns.js — CLI over lib/cloudflare.js. Cloudflare DNS as a drop-in alternative to
// lib/hostinger.js, for zones whose nameservers point at Cloudflare.
//
// Secrets: CLOUDFLARE_API_TOKEN is read from env ONLY, never argv — argv is world-readable
// via `ps` / /proc/<pid>/cmdline, so a token passed as a flag leaks to every user on the box.
// The token value is never printed, not even a preview: it grants DNS write on a live zone
// and has no diagnostic value in a log line.
//
//   node scripts/dns.js zones                                   # zones this token can see
//   node scripts/dns.js list   --zone <root.tld> [--type A] [--name <fqdn>]
//   node scripts/dns.js create --zone <root.tld> --type A --name api-foo --content 1.2.3.4 [--proxied]
//   node scripts/dns.js delete --zone <root.tld> --record-id <id> --yes
//   node scripts/dns.js set    --domain <fqdn> --type A --target <value> [--proxied]
//
// `set` is the one /sc-all-style callers want: it delegates to configureDnsRecord, which is
// idempotent (no-ops when the record already matches, PATCHes one record id when it does not)
// and never throws. It exits 1 on { skipped: true } so a caller can branch on nothing-written.
//
// UNLIKE scripts/hostinger-dns.js there is no "back the zone up first" ritual, because there
// is nothing to restore: every write here goes through a per-record endpoint guarded in
// lib/cloudflare.js, so the blast radius of any single command is one record. `delete` is
// still gated behind an explicit --yes (and --allow-apex for the zone apex): the apex A of a
// live zone is usually pointing at a production storefront, and that is not a record to
// remove on a typo.
//
// `--proxied` defaults OFF and must be opted into explicitly. A proxied (orange-cloud) record
// makes Cloudflare terminate TLS at its edge, so Traefik never sees the Let's Encrypt HTTP-01
// challenge on :80 and the Dokploy panel never gets a certificate; it also breaks the
// websocket/long-poll transport a self-hosted Convex backend needs. See the header comment in
// lib/cloudflare.js for the full mechanism.
//
// Env: CLOUDFLARE_API_TOKEN (required; needs Zone:Read + Zone:DNS:Edit)
//      CLOUDFLARE_ZONE_ID   (optional; pins the zone so a token WITHOUT Zone:Read still works
//                            — the dashboard "Edit zone DNS" template does not grant Zone:Read)
// CLOUDFLARE_ACCOUNT_ID is NOT needed for DNS and is deliberately not required here.
const path = require('path');
const {
  makeClient, configureDnsRecord,
} = require(path.resolve(__dirname, '../../../lib/cloudflare'));

// Same parser as scripts/hostinger-dns.js: supports `--k v`, `--k=v`, and bare boolean flags.
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq !== -1) { o[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2);
    const n = argv[i + 1];
    if (n !== undefined && !n.startsWith('--')) { o[k] = n; i++; } else { o[k] = true; }
  }
  return o;
}

// A bare `--proxied` parses to boolean true; `--proxied=false` parses to the STRING "false",
// which is truthy. Only these two spellings mean yes, so the string can never turn the proxy
// on by accident — the same `=== true` discipline lib/cloudflare.js applies internally.
const flagOn = (v) => v === true || v === 'true';

// SCV-1 (mirrors lib/vercel.js): reject a non-IPv4 A target here, before it reaches the API,
// so the failure names the actual problem instead of arriving as a Cloudflare validation code.
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// Cloudflare names records by FQDN, so a bare label from the CLI has to be expanded against
// the resolved zone name. '@' is Hostinger's apex sentinel and is accepted for muscle memory,
// but it expands to the zone name and is announced loudly — sending a literal '@' through
// would create a record called '@.example.com'.
function toFqdn(name, zoneName, zoneArg) {
  const n = String(name).trim().replace(/\.$/, '').toLowerCase();
  const root = String(zoneName || zoneArg || '').trim().replace(/\.$/, '').toLowerCase();
  if (n === '@' || n === '') {
    if (!root) throw new Error("cannot expand '@': zone name unknown (pass --name as a full FQDN)");
    return root;
  }
  if (!root) {
    if (!n.includes('.')) throw new Error(`cannot expand label '${n}': zone name unknown (pass --name as a full FQDN)`);
    return n;
  }
  if (n === root || n.endsWith(`.${root}`)) return n;
  return `${n}.${root}`;
}

const recordRow = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  content: r.content,
  ttl: r.ttl === 1 ? 'auto' : r.ttl,
  proxied: r.proxied === true ? 'PROXIED' : 'dns-only',
});

// Resolve --zone to a zone id, and fail with the flag name the user actually typed.
async function zoneOf(client, zoneArg) {
  if (!zoneArg || zoneArg === true) throw new Error('--zone <root.tld> is required');
  const z = await client.resolveZone(String(zoneArg).trim());
  if (z.error) throw new Error(z.error);
  return z;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const token = process.env.CLOUDFLARE_API_TOKEN;

  if (!token) {
    console.error('❌ CLOUDFLARE_API_TOKEN not set in env.');
    console.error('   Set it first:  node bin/onboard.js --domains cf  (then: source ~/.bashrc)');
    process.exit(1);
  }

  // The client resolves the token from the environment on every call; nothing token-shaped is
  // ever passed through argv or echoed back out.
  const client = makeClient({ apiToken: token });

  if (cmd === 'zones') {
    // Paginated on purpose: an unfiltered GET /zones truncates at 20, so on a busy account the
    // zone you are looking for can simply be missing from page 1.
    const rows = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await client.call(`/zones?per_page=50&page=${page}`);
      const list = Array.isArray(batch) ? batch : [];
      rows.push(...list);
      if (list.length < 50) break;
    }
    if (rows.length === 0) {
      // Far more often a token-scope problem than a genuinely empty account: the "Edit zone
      // DNS" template grants Zone:DNS:Edit but NOT Zone:Read, and GET /zones then answers
      // 200 success:true result:[] rather than a 403.
      console.log('ℹ️ no zones visible to this token — it likely lacks Zone:Read.');
      console.log('   Either add Zone:Read to the token, or set CLOUDFLARE_ZONE_ID and skip zone lookup.');
      return;
    }
    console.table(rows.map(z => ({
      id: z.id,
      name: z.name,
      status: z.status || '—',
      paused: z.paused === true ? 'yes' : 'no',
      account: (z.account && z.account.name) || '—',
    })));
    return;
  }

  if (cmd === 'list') {
    const z = await zoneOf(client, args.zone);
    const type = args.type && args.type !== true ? String(args.type).toUpperCase() : undefined;
    const name = args.name && args.name !== true ? toFqdn(args.name, z.zoneName, args.zone) : undefined;
    console.log(`🌐 zone ${z.zoneName || String(args.zone)} (${z.zoneId})`);
    // listRecords needs BOTH name and type to use the exact filter; with only one of them set
    // it falls back to the full listing, so filter the remainder client-side.
    let records = await client.listRecords(
      name && type ? { zoneId: z.zoneId, name, type } : { zoneId: z.zoneId },
    );
    if (type) records = records.filter(r => r.type === type);
    if (name) records = records.filter(r => r.name === name);
    if (records.length === 0) { console.log('ℹ️ no matching records'); return; }
    console.table(records.map(recordRow));
    return;
  }

  if (cmd === 'create') {
    const { type: rawType, content } = args;
    if (!args.name || args.name === true || !rawType || rawType === true || !content || content === true) {
      console.error('usage: create --zone <root.tld> --type A|AAAA|CNAME|TXT --name <label-or-fqdn> --content <value> [--proxied] [--ttl <s>]');
      process.exit(1);
    }
    const type = String(rawType).toUpperCase();
    const proxied = flagOn(args.proxied);
    const ttl = args.ttl && args.ttl !== true ? Number(args.ttl) : 1;
    // Validate before the zone lookup so an obviously bad target costs no API call.
    if (type === 'A' && !IPV4_RE.test(String(content))) {
      console.error(`❌ --content '${content}' is not a dotted-quad IPv4 — an A record needs one.`);
      process.exit(1);
    }

    const z = await zoneOf(client, args.zone);
    const fqdn = toFqdn(args.name, z.zoneName, args.zone);
    // Same zoneName-or-zoneArg fallback toFqdn itself uses two lines up: a CLOUDFLARE_ZONE_ID
    // pin skips zone lookup, so z.zoneName is null under exactly the least-privilege token
    // configuration this skill recommends. Comparing against z.zoneName alone would silence
    // the apex warning precisely there.
    const zoneRoot = String(z.zoneName || args.zone || '').trim().replace(/\.$/, '').toLowerCase();
    if (zoneRoot && fqdn === zoneRoot) {
      // The apex usually carries whatever the domain's public site runs on. Creating there is
      // legitimate, but it should never happen without the operator noticing.
      console.log(`⚠️ '${fqdn}' is the ZONE APEX — this is the record the root domain resolves to.`);
    }
    if (proxied) {
      console.log('⚠️ --proxied: Cloudflare will terminate TLS at its edge for this name.');
      console.log("   Traefik's HTTP-01/TLS-ALPN-01 challenge cannot complete behind the proxy —");
      console.log('   switch it to the DNS-01 challenge, or drop --proxied.');
    }

    console.log(`📝 POST ${type} '${fqdn}' -> ${content} in zone ${z.zoneName || z.zoneId} (${proxied ? 'proxied' : 'DNS-only'})...`);
    const rec = await client.createRecord({
      zoneId: z.zoneId, name: fqdn, type, content: String(content), ttl, proxied,
      comment: 'managed by si-coder /sc-cf',
    });
    console.log('✅ created');
    console.log(JSON.stringify(rec, null, 2));
    return;
  }

  if (cmd === 'delete') {
    const recordId = args['record-id'];
    if (!recordId || recordId === true) {
      console.error('usage: delete --zone <root.tld> --record-id <id> --yes  (run `list` first to get the id)');
      process.exit(1);
    }
    const z = await zoneOf(client, args.zone);
    // Show the operator the record BEFORE it goes, resolved from the zone's own listing rather
    // than from whatever they typed — a mistyped id must not be able to delete a real record.
    const all = await client.listRecords({ zoneId: z.zoneId });
    const target = all.find(r => r && r.id === recordId);
    if (!target) {
      console.error(`❌ record ${recordId} not found in zone ${z.zoneName || z.zoneId}.`);
      console.error(`   List the zone first:  node scripts/dns.js list --zone ${args.zone}`);
      process.exit(1);
    }
    console.table([recordRow(target)]);

    // The apex root must NOT come from z.zoneName alone. resolveZone's CLOUDFLARE_ZONE_ID pin
    // path returns zoneName: null (it skips zone lookup by design, because the "Edit zone DNS"
    // token template has no Zone:Read) — so `z.zoneName && ...` evaluates to null and the
    // refusal below never fires, in exactly the configuration this skill documents. Fall back
    // to the --zone the operator typed, the same way toFqdn already does. An unknown zone name
    // must never be able to disable the guard.
    const zoneRoot = String(z.zoneName || args.zone || '').trim().replace(/\.$/, '').toLowerCase();
    const isApex = zoneRoot ? target.name === zoneRoot : null; // null == "cannot tell"
    if (isApex === null && !flagOn(args['allow-apex'])) {
      // Unreachable while --zone is mandatory (zoneOf throws without it); kept so the guard
      // fails CLOSED rather than falling through if that ever stops being true.
      console.error('❌ cannot determine the zone apex for this zone (zone name unknown under a CLOUDFLARE_ZONE_ID pin).');
      console.error('   Re-run with --allow-apex if you are certain, or unset CLOUDFLARE_ZONE_ID so the apex can be checked.');
      process.exit(1);
    }
    if (isApex && !flagOn(args['allow-apex'])) {
      console.error(`❌ '${target.name}' is the ZONE APEX — the record the root domain itself resolves to.`);
      console.error('   Deleting it takes the bare domain offline. Re-run with --allow-apex if that is genuinely intended.');
      process.exit(1);
    }
    if (!flagOn(args.yes)) {
      // Dry run by default: delete is the only irreversible command in this CLI.
      console.log('ℹ️ dry run — nothing deleted. Re-run with --yes to remove the record above.');
      process.exit(1);
    }

    console.log(`🧹 DELETE ${target.type} '${target.name}' (${target.id})...`);
    const r = await client.deleteRecord({ zoneId: z.zoneId, recordId });
    console.log(r && r.alreadyGone ? '✅ already gone' : '✅ deleted');
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  if (cmd === 'set') {
    const { domain: fullDomain, type = 'A', target } = args;
    if (!fullDomain || fullDomain === true || !target || target === true) {
      console.error('usage: set --domain <fqdn> --type A|AAAA|CNAME|TXT --target <value> [--proxied] [--ttl <s>]');
      process.exit(1);
    }
    const proxied = flagOn(args.proxied);
    if (proxied) {
      console.log('⚠️ --proxied: an orange-cloud record blocks Traefik from obtaining a Let\'s Encrypt');
      console.log('   certificate (HTTP-01 never reaches the origin) and degrades Convex websockets.');
    }
    // configureDnsRecord never throws — everything, including a timeout or a Cloudflare error
    // envelope, comes back as { skipped: true, reason }.
    const r = await configureDnsRecord({
      fullDomain: String(fullDomain), type: String(type), target: String(target),
      proxied, ttl: args.ttl && args.ttl !== true ? Number(args.ttl) : 1,
      cloudflareToken: token,
    });
    console.log(JSON.stringify(r, null, 2));
    // A clashing record has to be removed before the replacement can be created, so a failed
    // create can leave the name with nothing on it. `destroyed` says that happened; say so in
    // words rather than leaving it buried in the JSON dump above.
    if (r.destroyed) {
      console.error(`❌ a pre-existing record on ${String(fullDomain)} was removed and the replacement did NOT land.`);
      console.error(r.restored
        ? '   It was restored automatically — verify with: node scripts/dns.js list --zone <root.tld>'
        : '   The automatic restore FAILED. Re-create it from priorRecords above, now.');
    }
    // skipped means the record is not in place — surface it as a failure so callers can branch.
    process.exit(r.skipped ? 1 : 0);
  }

  console.error('commands: zones | list --zone <root> | create --zone <root> --type <T> --name <n> --content <v> [--proxied]');
  console.error('        | delete --zone <root> --record-id <id> --yes | set --domain <fqdn> --type <T> --target <v> [--proxied]');
  process.exit(1);
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
