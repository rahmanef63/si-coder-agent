#!/usr/bin/env node
// projects.js — Dokploy project CRUD
const { getClient, parseArgs, findProject, allApplications, allCompose } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dokploy = getClient();

  if (cmd === 'list') {
    const projects = await dokploy.listProjects();
    console.table(projects.map(p => ({
      name: p.name,
      apps: allApplications(p).length,
      compose: allCompose(p).length,
    })));
    return;
  }
  if (cmd === 'create') {
    const name = args._[1];
    if (!name) { console.error('Usage: projects.js create <name>'); process.exit(1); }
    await dokploy.createProject(name);
    console.log(`✅ project '${name}' created`);
    return;
  }
  if (cmd === 'show') {
    const name = args._[1];
    if (!name) { console.error('Usage: projects.js show <name>'); process.exit(1); }
    const p = await findProject(dokploy, name);
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  console.error('Usage: projects.js <list|create|show> [name]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
