#!/usr/bin/env node
// domains.js — Dokploy domain CRUD
const { getClient, parseArgs } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dokploy = getClient();

  if (cmd === 'list-app') {
    if (!args['app-id']) { console.error('Usage: domains.js list-app --app-id <id>'); process.exit(1); }
    const app = await dokploy.getApplication(args['app-id']);
    console.table((app.domains || []).map(d => ({ host: d.host, port: d.port, https: d.https, id: d.domainId })));
    return;
  }
  if (cmd === 'list-compose') {
    if (!args['compose-id']) { console.error('Usage: domains.js list-compose --compose-id <id>'); process.exit(1); }
    const c = await dokploy.getCompose(args['compose-id']);
    console.table((c.domains || []).map(d => ({ host: d.host, port: d.port, service: d.serviceName, id: d.domainId })));
    return;
  }
  if (cmd === 'create-app') {
    if (!args['app-id'] || !args.host) { console.error('Usage: domains.js create-app --app-id <id> --host <host> [--port N]'); process.exit(1); }
    try {
      await dokploy.createDomain({
        applicationId: args['app-id'],
        host: args.host,
        https: true,
        certificateType: 'letsencrypt',
        ...(args.port ? { port: Number(args.port) } : {}),
      });
      console.log(`✅ domain ${args.host} created on app ${args['app-id']}`);
    } catch (e) {
      console.warn(`⚠️ ${e.message} (likely already exists, idempotent skip)`);
    }
    return;
  }
  if (cmd === 'create-compose') {
    if (!args['compose-id'] || !args.host || !args.port || !args.service || args.port === true || args.service === true) {
      console.error('Usage: domains.js create-compose --compose-id <id> --host <host> --port <n> --service <name>');
      process.exit(1);
    }
    const port = Number(args.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      console.error('--port must be 1..65535');
      process.exit(1);
    }
    try {
      await dokploy.createDomain({
        composeId: args['compose-id'],
        host: args.host,
        port,
        serviceName: args.service,
        https: true,
        certificateType: 'letsencrypt',
      });
      console.log(`✅ domain ${args.host} created on compose ${args['compose-id']}`);
    } catch (e) {
      console.warn(`⚠️ ${e.message} (likely already exists)`);
    }
    return;
  }
  if (cmd === 'delete') {
    if (!args['domain-id']) { console.error('Usage: domains.js delete --domain-id <id>'); process.exit(1); }
    await dokploy.deleteDomain(args['domain-id']);
    console.log(`🧹 domain ${args['domain-id']} deleted`);
    return;
  }
  console.error('Usage: domains.js <list-app|list-compose|create-app|create-compose|delete> [...]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
