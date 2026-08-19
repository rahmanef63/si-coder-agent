#!/usr/bin/env node
// hostinger-dns.js — standalone CLI over lib/hostinger.js.
//
// The bundle ships Hostinger DNS as a library only (lib/hostinger.js), called from
// deploy-convex.js / sc-vercel. There is no /sc-hostinger skill, so there was no way
// to inspect a zone or write a single record on its own. This is that missing surface.
//
// Secrets: HOSTINGER_API_TOKEN is read from env ONLY, never argv — same posture as the
// rest of the bundle (argv is world-readable via ps / /proc/<pid>/cmdline).
//
//   node scripts/hostinger-dns.js portfolio                  # domains on the account
//   node scripts/hostinger-dns.js vps                        # VPS instances + public IPv4
//   node scripts/hostinger-dns.js zone <root-domain>         # dump zone as JSON (back it up!)
//   node scripts/hostinger-dns.js set --domain <fqdn> --type A --target <ip>
//
// `set` is idempotent (configureDnsRecord no-ops when the record already matches) but it
// PUTs the WHOLE zone back. Always run `zone` first and keep the output — that dump is
// the only rollback you have.
const path = require('path');
const { configureDnsRecord } = require(path.resolve(__dirname, '../lib/hostinger'));

const API = 'https://developers.hostinger.com/api';
const TIMEOUT_MS = 15000;

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

async function get(url, token) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: c.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout after ${TIMEOUT_MS}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// The VPS list is what makes an A record possible without shell access to the box:
// it maps each instance to the public IPv4 the record has to point at.
function ipv4Of(vm) {
  const v4 = (vm.ipv4 || vm.ipv4_addresses || vm.ip_addresses || []).find?.(x => x && (x.address || x.ip));
  return v4 ? (v4.address || v4.ip) : (vm.ip || vm.main_ip || '—');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const token = process.env.HOSTINGER_API_TOKEN;

  if (!token) {
    console.error('❌ HOSTINGER_API_TOKEN not set in env.');
    console.error('   Set it first:  node bin/onboard.js --domains hostinger  (then: source ~/.bashrc)');
    process.exit(1);
  }

  if (cmd === 'portfolio') {
    const domains = await get(`${API}/domains/v1/portfolio`, token);
    console.table(domains.map(d => ({
      domain: d.domain,
      status: d.status || '—',
      type: d.type || '—',
      expires: d.expires_at || d.expire_at || '—',
    })));
    return;
  }

  if (cmd === 'vps') {
    const vms = await get(`${API}/vps/v1/virtual-machines`, token);
    console.table(vms.map(vm => ({
      id: vm.id,
      hostname: vm.hostname || '—',
      state: vm.state || vm.status || '—',
      ipv4: ipv4Of(vm),
    })));
    return;
  }

  if (cmd === 'zone') {
    const root = args._[1];
    if (!root) { console.error('usage: zone <root-domain>'); process.exit(1); }
    const zone = await get(`${API}/dns/v1/zones/${encodeURIComponent(root)}`, token);
    // Full JSON, not a table — this is the backup you restore from.
    console.log(JSON.stringify(zone, null, 2));
    return;
  }

  if (cmd === 'set') {
    const { domain: fullDomain, type = 'A', target } = args;
    if (!fullDomain || !target) {
      console.error('usage: set --domain <fqdn> --type A|CNAME|TXT --target <value>');
      process.exit(1);
    }
    const r = await configureDnsRecord({ fullDomain, type, target, hostingerToken: token });
    console.log(JSON.stringify(r, null, 2));
    // skipped means nothing was written — surface it as a failure so callers can branch.
    process.exit(r.skipped ? 1 : 0);
  }

  console.error('commands: portfolio | vps | zone <root> | set --domain <fqdn> --type <T> --target <v>');
  process.exit(1);
}

main().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
