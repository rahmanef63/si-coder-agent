// lib/hostinger.js — Hostinger DNS automation (A record sync)
const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);

async function configureDns({ fullDomain, dokployApiUrl, hostingerToken }) {
  if (!hostingerToken || !fullDomain) {
    return { skipped: true, reason: 'no token or no fullDomain' };
  }
  try {
    console.log(`\n🌍 checking Hostinger DNS for ${fullDomain}...`);
    const apiHost = new URL(dokployApiUrl).hostname;
    const { address: serverIp } = await lookup(apiHost);

    const portfolioRes = await fetch('https://developers.hostinger.com/api/domains/v1/portfolio', {
      headers: { Authorization: `Bearer ${hostingerToken}`, Accept: 'application/json' },
    });
    if (!portfolioRes.ok) return { skipped: true, reason: `portfolio ${portfolioRes.status}` };
    const domains = await portfolioRes.json();

    let rootDomain = null;
    let subdomain = '@';
    for (const d of domains) {
      if (fullDomain === d.domain) { rootDomain = d.domain; subdomain = '@'; break; }
      if (fullDomain.endsWith(`.${d.domain}`)) {
        rootDomain = d.domain;
        subdomain = fullDomain.replace(`.${d.domain}`, '');
        break;
      }
    }
    if (!rootDomain) {
      console.log(`⚠️ root domain for ${fullDomain} not in Hostinger portfolio`);
      return { skipped: true, reason: 'root not in portfolio' };
    }

    const zoneRes = await fetch(`https://developers.hostinger.com/api/dns/v1/zones/${rootDomain}`, {
      headers: { Authorization: `Bearer ${hostingerToken}`, Accept: 'application/json' },
    });
    if (!zoneRes.ok) return { skipped: true, reason: `zone ${zoneRes.status}` };
    const zoneRecords = await zoneRes.json();
    if (!Array.isArray(zoneRecords)) return { skipped: true, reason: 'zone not array' };

    const exists = zoneRecords.some(r => r.name === subdomain && r.type === 'A');
    if (exists) {
      console.log(`✅ A record for ${fullDomain} already exists`);
      return { skipped: false, alreadyExists: true };
    }

    console.log(`📝 adding A '${subdomain}' -> ${serverIp} in ${rootDomain}...`);
    zoneRecords.push({ name: subdomain, type: 'A', ttl: 14400, records: [{ content: serverIp, is_disabled: false }] });

    const putRes = await fetch(`https://developers.hostinger.com/api/dns/v1/zones/${rootDomain}`, {
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

module.exports = { configureDns };
