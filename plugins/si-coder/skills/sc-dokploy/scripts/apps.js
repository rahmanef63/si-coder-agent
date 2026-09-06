#!/usr/bin/env node
// apps.js — Dokploy application CRUD
const { getClient, parseArgs, findProject, allApplications, redactObject } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dokploy = getClient();

  if (cmd === 'list') {
    if (!args.project) { console.error('Usage: apps.js list --project <name>'); process.exit(1); }
    const p = await findProject(dokploy, args.project);
    const apps = allApplications(p);
    console.table(apps.map(a => ({
      name: a.name,
      id: a.applicationId,
      status: a.applicationStatus,
      domains: (a.domains || []).map(d => d.host).join(','),
    })));
    return;
  }
  if (cmd === 'show') {
    if (!args.project || !args.app) { console.error('Usage: apps.js show --project <name> --app <name>'); process.exit(1); }
    const p = await findProject(dokploy, args.project);
    const a = allApplications(p).find(x => x.name === args.app);
    if (!a) { console.error(`app '${args.app}' not found`); process.exit(1); }
    const full = await dokploy.getApplication(a.applicationId);
    // SCD-SEC-2 + SCD-COR-1: redact env AND other credential-bearing fields (no more
    // misleading "use the env subcommand" hint — apps.js has no such subcommand).
    console.log(JSON.stringify(redactObject(full), null, 2));
    return;
  }
  if (cmd === 'deploy') {
    if (!args.project || !args.app) { console.error('Usage: apps.js deploy --project <name> --app <name>'); process.exit(1); }
    const p = await findProject(dokploy, args.project);
    const a = allApplications(p).find(x => x.name === args.app);
    if (!a) { console.error(`app '${args.app}' not found`); process.exit(1); }
    await dokploy.deployApplication(a.applicationId);
    console.log(`🚀 deploy triggered for ${args.app} (${a.applicationId})`);
    return;
  }
  console.error('Usage: apps.js <list|show|deploy> --project <name> [--app <name>]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
