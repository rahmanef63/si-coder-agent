#!/usr/bin/env node
// audit.js — Sweep all Dokploy projects for stale domains, duplicates, traefik.me leftovers, missing INSTANCE_SECRET.
const { getClient, parseArgs, allApplications, allCompose } = require('./_shared');
const path = require('path');
const { parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

function findDuplicates(domains = []) {
  // Use a Set, not a bare object: hosts named like Object.prototype members
  // (toString, constructor, …) are truthy on first sight via prototype inheritance
  // and would be falsely flagged DUPLICATE_HOST (then deleted under --fix).
  const seen = new Set();
  const dups = [];
  for (const d of domains) {
    if (seen.has(d.host)) dups.push(d);
    else seen.add(d.host);
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
    if (!p.environments?.length) continue;

    for (const app of allApplications(p)) {
      let full;
      try { full = await dokploy.getApplication(app.applicationId); }
      catch (e) { findings.push({ project: p.name, kind: 'app', name: app.name, issue: 'FETCH_ERROR', error: e.message }); continue; }
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

    for (const c of allCompose(p)) {
      let full;
      try { full = await dokploy.getCompose(c.composeId); }
      catch (e) { findings.push({ project: p.name, kind: 'compose', name: c.name, issue: 'FETCH_ERROR', error: e.message }); continue; }
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
    const seenIds = new Set();
    for (const f of findings) {
      if (f.domainId && (f.issue === 'TRAEFIK_ME' || f.issue === 'DUPLICATE_HOST')) {
        if (seenIds.has(f.domainId)) continue;
        seenIds.add(f.domainId);
        try { await dokploy.deleteDomain(f.domainId); console.log(`  removed ${f.host}`); }
        catch (e) { console.warn(`  ⚠️ ${f.host}: ${e.message}`); }
      }
    }
  } else {
    console.log('\nRun with --fix to remove TRAEFIK_ME + DUPLICATE_HOST entries.');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
