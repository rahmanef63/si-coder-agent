#!/usr/bin/env node
// debug.js — Status and recent-deployment inspection.
const { getClient, parseArgs, findProject, allApplications } = require('./_shared');
// SCD-COR-2: reuse compose.js findCompose so --compose status gets the same ambiguity
// detection (throws on same-named composes across projects) + --project disambiguation.
const { findCompose } = require('./compose');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dokploy = getClient();

  if (cmd === 'status') {
    if (args.project && args.app) {
      const p = await findProject(dokploy, args.project);
      const a = allApplications(p).find(x => x.name === args.app);
      if (!a) { console.error(`app '${args.app}' not in '${args.project}'`); process.exit(1); }
      const full = await dokploy.getApplication(a.applicationId);
      console.log(JSON.stringify({
        name: full.name,
        applicationStatus: full.applicationStatus,
        sourceType: full.sourceType,
        branch: full.branch,
        owner: full.owner,
        repository: full.repository,
        dockerfile: full.dockerfile,
        triggerType: full.triggerType,
        autoDeploy: full.autoDeploy,
        domains: (full.domains || []).map(d => d.host),
      }, null, 2));
      return;
    }
    if (args.compose) {
      const { compose: target } = await findCompose(dokploy, args.compose, args.project);
      const full = await dokploy.getCompose(target.composeId);
      console.log(JSON.stringify({
        name: full.name,
        composeStatus: full.composeStatus,
        appName: full.appName,
        domains: (full.domains || []).map(d => `${d.host}:${d.port}/${d.serviceName}`),
      }, null, 2));
      return;
    }
    console.error('Usage: debug.js status --project X --app Y  |  --compose Z [--project X]');
    process.exit(1);
  }
  if (cmd === 'deployments') {
    if (!args['app-id']) { console.error('Usage: debug.js deployments --app-id <id>'); process.exit(1); }
    // Dokploy doesn't expose a clean deployments list endpoint via its public REST; surface a hint instead.
    console.log('ℹ️ Dokploy deployment logs are dashboard-only.');
    console.log(`   Open: ${process.env.DOKPLOY_API_URL?.replace(/\/api$/, '')} → service → Deployments`);
    return;
  }
  console.error('Usage: debug.js <status|deployments> ...');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
