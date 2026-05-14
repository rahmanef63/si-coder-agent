#!/usr/bin/env node
// audit.js — Sweep all Dokploy projects for stale domains, duplicates, traefik.me leftovers, missing INSTANCE_SECRET.
const { getClient, parseArgs } = require('./_shared');
const path = require('path');
const { parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

function findDuplicates(domains = []) {
  const seen = {};
  const dups = [];
  for (const d of domains) {
    if (seen[d.host]) dups.push(d);
    else seen[d.host] = true;
  }
  return dups;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dokploy = getClient();
  const doFix = !!args.fix;

  const projects = await dokploy.listProjects();
  const findings = [];

  for (const p of projects) {
    const env = p.environments?.[0];
    if (!env) continue;

    for (const app of env.applications || []) {
      const full = await dokploy.getApplication(app.applicationId);
      const domains = full.domains || [];
      if (domains.length === 0) {
        findings.push({ project: p.name, kind: 'app', name: app.name, issue: 'NO_DOMAIN' });
      }
      for (const d of domains) {
        if (d.host?.endsWith('.traefik.me')) {
          findings.push({ project: p.name, kind: 'app', name: app.name, issue: 'TRAEFIK_ME', domainId: d.domainId, host: d.host });
        }
      }
      for (const dup of findDuplicates(domains)) {
        findings.push({ project: p.name, kind: 'app', name: app.name, issue: 'DUPLICATE_HOST', domainId: dup.domainId, host: dup.host });
      }
    }

    for (const c of env.compose || []) {
      const full = await dokploy.getCompose(c.composeId);
      const cEnv = parseEnvString(full.env || '');
      if (!cEnv.INSTANCE_SECRET) {
        findings.push({ project: p.name, kind: 'compose', name: c.name, issue: 'MISSING_INSTANCE_SECRET' });
      }
      const domains = full.domains || [];
      for (const d of domains) {
        if (d.host?.endsWith('.traefik.me')) {
          findings.push({ project: p.name, kind: 'compose', name: c.name, issue: 'TRAEFIK_ME', domainId: d.domainId, host: d.host });
        }
      }
      for (const dup of findDuplicates(domains)) {
        findings.push({ project: p.name, kind: 'compose', name: c.name, issue: 'DUPLICATE_HOST', domainId: dup.domainId, host: dup.host });
      }
    }
  }

  console.table(findings);
  if (findings.length === 0) { console.log('✅ all clean'); return; }

  if (doFix) {
    console.log('\n🧹 --fix mode: deleting stale domains...');
    for (const f of findings) {
      if (f.domainId && (f.issue === 'TRAEFIK_ME' || f.issue === 'DUPLICATE_HOST')) {
        try { await dokploy.deleteDomain(f.domainId); console.log(`  removed ${f.host}`); }
        catch (e) { console.warn(`  ⚠️ ${f.host}: ${e.message}`); }
      }
    }
  } else {
    console.log('\nRun with --fix to remove TRAEFIK_ME + DUPLICATE_HOST entries.');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
