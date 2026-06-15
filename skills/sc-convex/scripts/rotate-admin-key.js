#!/usr/bin/env node
// rotate-admin-key.js — Generate fresh admin key from running container + sync Dokploy env + optional local .env.
const fs = require('fs');
const path = require('path');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/dokploy'));
const { generateAdminKey } = require(path.resolve(__dirname, '../../../lib/convex'));
const { mergeEnvString, parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    }
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const composeName = args['compose-name'];
  const envFile = args['env-file'];
  const envVarName = args['env-name'] || 'CONVEX_SELF_HOSTED_ADMIN_KEY';

  // typeof check rejects a bare `--compose-name` flag (parseArgs yields `true`),
  // so the compose lookup can't match on the boolean `true`.
  if (typeof composeName !== 'string') { console.error('Usage: rotate-admin-key.js --compose-name <APP>-db [--env-file ./.env] [--env-name CONVEX_SELF_HOSTED_ADMIN_KEY]'); process.exit(1); }

  const apiUrl = process.env.DOKPLOY_API_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;
  if (!apiUrl || !apiKey) { console.error('Missing DOKPLOY_API_URL / DOKPLOY_API_KEY'); process.exit(1); }

  const dokploy = makeClient({ apiUrl, apiKey });

  // Find the compose by name across projects
  const projects = await dokploy.listProjects();
  let compose = null;
  for (const p of projects) {
    const c = p.environments?.[0]?.compose?.find(x => x.name === composeName);
    if (c) { compose = c; break; }
  }
  if (!compose) throw new Error(`Compose '${composeName}' not found`);

  const latest = await dokploy.getCompose(compose.composeId);
  const runtimeName = latest.appName || compose.appName;
  const containerName = `${runtimeName}-backend-1`;

  console.log(`🔑 Generating admin key from ${containerName}...`);
  const adminKey = generateAdminKey({ containerName });

  await dokploy.updateComposeEnv(compose.composeId, { CONVEX_ADMIN_KEY: adminKey });
  console.log('✅ Dokploy compose env updated');

  if (envFile) {
    const existing = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
    const merged = mergeEnvString(existing, { [envVarName]: adminKey });
    fs.writeFileSync(envFile, merged + '\n', { mode: 0o600 });
    try { fs.chmodSync(envFile, 0o600); } catch {} // tighten even if file pre-existed
    console.log(`✅ ${envFile} updated (${envVarName}, mode 600)`);
  }

  const maskSecret = (s = '') => (String(s).length <= 4 ? '****' : `len=${String(s).length} …${String(s).slice(-4)}`);
  console.log(`\n🔐 Admin key generated (masked): ${maskSecret(adminKey)}`);
  if (envFile) console.log(`   Full value written to ${envFile} (mode 600).`);
  else console.log('   Re-run with --env-file ./.env to capture the full value securely.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
