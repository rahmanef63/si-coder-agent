// lib/hostinger.js — Hostinger DNS automation (A + CNAME record sync)
const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);

const PORTFOLIO_URL = 'https://developers.hostinger.com/api/domains/v1/portfolio';
const zoneUrl = (root) => `https://developers.hostinger.com/api/dns/v1/zones/${encodeURIComponent(root)}`; // S15: encode root

// Find which portfolio root domain `fullDomain` belongs to. Returns { rootDomain, subdomain } or { error }.
async function resolveRoot(fullDomain, hostingerToken) {
  const res = await fetch(PORTFOLIO_URL, {
    headers: { Authorization: `Bearer ${hostingerToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return { error: `portfolio ${res.status}` };
  const domains = await res.json();
  for (const d of domains) {
    if (fullDomain === d.domain) return { rootDomain: d.domain, subdomain: '@' };
    if (fullDomain.endsWith(`.${d.domain}`)) {
      return { rootDomain: d.domain, subdomain: fullDomain.replace(`.${d.domain}`, '') };
    }
  }
  return { error: 'root not in portfolio' };
}

// CORE: idempotently ensure a single DNS record. type: 'A' | 'CNAME' | 'TXT'.
// Never throws — returns a status object (mirrors configureDns contract).
async function configureDnsRecord({ fullDomain, type, target, hostingerToken }) {
  if (!hostingerToken || !fullDomain || !type || !target) {
    return { skipped: true, reason: 'missing token/fullDomain/type/target' };
  }
  try {
    console.log(`\n🌍 Hostinger DNS: ensure ${type} '${fullDomain}' -> ${target}`);
    const r = await resolveRoot(fullDomain, hostingerToken);
    if (r.error) { console.log(`⚠️ ${r.error}`); return { skipped: true, reason: r.error }; }
    const { rootDomain, subdomain } = r;

    const zoneRes = await fetch(zoneUrl(rootDomain), {
      headers: { Authorization: `Bearer ${hostingerToken}`, Accept: 'application/json' },
    });
    if (!zoneRes.ok) return { skipped: true, reason: `zone ${zoneRes.status}` };
    const zoneRecords = await zoneRes.json();
    if (!Array.isArray(zoneRecords)) return { skipped: true, reason: 'zone not array' };

    // Idempotency: same name+type already present?
    const existing = zoneRecords.find(rr => rr.name === subdomain && rr.type === type);
    if (existing) {
      const hasTarget = (existing.records || []).some(x => (x.content || '').replace(/\.$/, '') === String(target).replace(/\.$/, ''));
      if (hasTarget) {
        console.log(`✅ ${type} record for ${fullDomain} already correct`);
        return { skipped: false, alreadyExists: true };
      }
      // Update wrong target in place
      existing.records = [{ content: target, is_disabled: false }];
    } else {
      // CNAME and A on the same name conflict; if switching apex/sub, drop a clashing A/CNAME first.
      // Guard: only A<->CNAME clash; TXT can coexist and must NOT trigger removal.
      if (type === 'A' || type === 'CNAME') {
        const clashType = type === 'A' ? 'CNAME' : 'A';
        const clashIdx = zoneRecords.findIndex(rr => rr.name === subdomain && rr.type === clashType);
        if (clashIdx >= 0) zoneRecords.splice(clashIdx, 1);
      }
      zoneRecords.push({ name: subdomain, type, ttl: 14400, records: [{ content: target, is_disabled: false }] });
    }

    console.log(`📝 PUT ${type} '${subdomain}' -> ${target} in ${rootDomain}...`);
    const putRes = await fetch(zoneUrl(rootDomain), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${hostingerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: zoneRecords }),
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      console.warn(`⚠️ Hostinger DNS PUT failed: ${t}`);
      return { skipped: true, reason: `PUT ${putRes.status}` };
    }
    console.log(`✅ Hostinger DNS updated for ${fullDomain}`);
    await new Promise(r => setTimeout(r, 5000));
    return { skipped: false, created: true };
  } catch (e) {
    console.warn(`⚠️ Hostinger DNS error: ${e.message}`);
    return { skipped: true, reason: e.message };
  }
}

// BACKWARD-COMPAT wrapper: A record pointing at the Dokploy server IP.
// Preserves the original signature + return contract used by deploy-convex.js.
async function configureDns({ fullDomain, dokployApiUrl, hostingerToken }) {
  if (!hostingerToken || !fullDomain) {
    return { skipped: true, reason: 'no token or no fullDomain' };
  }
  try {
    const apiHost = new URL(dokployApiUrl).hostname;
    const { address: serverIp } = await lookup(apiHost);
    return await configureDnsRecord({ fullDomain, type: 'A', target: serverIp, hostingerToken });
  } catch (e) {
    console.warn(`⚠️ Hostinger DNS error: ${e.message}`);
    return { skipped: true, reason: e.message };
  }
}

module.exports = { configureDns, configureDnsRecord };
