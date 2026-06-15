#!/usr/bin/env node
// compose.js — Dokploy compose CRUD
const { getClient, parseArgs, findProject, allCompose, isSecretEnv, redactObject } = require('./_shared');
const path = require('path');
const { parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

async function findCompose(dokploy, name, projectName) {
  const projects = await dokploy.listProjects();
  const matches = [];
  for (const p of projects) {
    if (projectName && p.name !== projectName) continue;
    const c = allCompose(p).find(x => x.name === name);
    if (c) matches.push({ project: p, compose: c });
  }
  if (matches.length === 0) throw new Error(`compose '${name}' not found${projectName ? ` in project '${projectName}'` : ' in any project'}`);
  if (matches.length > 1) {
    const projNames = matches.map(m => m.project.name).join(', ');
    throw new Error(`compose name '${name}' is ambiguous — exists in: ${projNames}. Pass --project <name> to disambiguate.`);
  }
  return matches[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const dokploy = getClient();

  if (cmd === 'list') {
    if (!args.project) { console.error('Usage: compose.js list --project <name>'); process.exit(1); }
    const p = await findProject(dokploy, args.project);
    const cs = allCompose(p);
    console.table(cs.map(c => ({
      name: c.name,
      id: c.composeId,
      status: c.composeStatus,
      domains: (c.domains || []).map(d => d.host).join(','),
    })));
    return;
  }
  if (cmd === 'show') {
    if (!args.compose) { console.error('Usage: compose.js show --compose <name> [--project <name>]'); process.exit(1); }
    const { compose } = await findCompose(dokploy, args.compose, args.project);
    const full = await dokploy.getCompose(compose.composeId);
    // SCD-SEC-2: redact env AND any other credential-bearing field (customGitUrl userinfo,
    // registryPassword, customGitSSHKey, dockerAuth, embedded tokens) — not just `env`.
    console.log(JSON.stringify(redactObject(full), null, 2));
    return;
  }
  if (cmd === 'env') {
    if (!args.compose) { console.error('Usage: compose.js env --compose <name> [--project <name>]'); process.exit(1); }
    const { compose } = await findCompose(dokploy, args.compose, args.project);
    const full = await dokploy.getCompose(compose.composeId);
    const env = parseEnvString(full.env || '');
    for (const [k, v] of Object.entries(env)) {
      // SCD-SEC-1: redact-by-default via the shared heuristic (broadened key regex +
      // value-shape entropy + URL userinfo) so plain-token secrets under non-obvious
      // key names (SK/PAT/SALT/ADMIN/…) can't print in full. Never leak a prefix.
      console.log(`${k}=${isSecretEnv(k, v) ? `‹redacted ${String(v).length} chars›` : v}`);
    }
    return;
  }
  if (cmd === 'deploy') {
    if (!args.compose) { console.error('Usage: compose.js deploy --compose <name> [--project <name>]'); process.exit(1); }
    const { compose } = await findCompose(dokploy, args.compose, args.project);
    await dokploy.deployCompose(compose.composeId);
    console.log(`🚀 deploy triggered for compose ${args.compose}`);
    return;
  }
  console.error('Usage: compose.js <list|show|env|deploy> [--project <n>] [--compose <n>]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
