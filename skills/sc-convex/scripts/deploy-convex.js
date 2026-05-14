#!/usr/bin/env node
// deploy-convex.js — Idempotent self-hosted Convex compose deploy on Dokploy.
const path = require('path');
const crypto = require('crypto');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/dokploy'));
const { configureDns } = require(path.resolve(__dirname, '../../../lib/hostinger'));
const { parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));
const { generateAdminKey, generateAuthKeys, setBackendEnv } = require(path.resolve(__dirname, '../../../lib/convex'));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { project, app, domain } = args;
  const withAuth = !!args['with-auth-keys'];

  if (!project || !app) {
    console.error('Usage: deploy-convex.js --project <PROJECT> --app <APP_NAME> [--domain root.tld] [--with-auth-keys]');
    process.exit(1);
  }

  const apiUrl = process.env.DOKPLOY_API_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;
  if (!apiUrl || !apiKey) { console.error('Missing DOKPLOY_API_URL / DOKPLOY_API_KEY'); process.exit(1); }

  const dokploy = makeClient({ apiUrl, apiKey });
  const composeName = `${app}-db`;

  console.log(`🐳 Convex compose deploy: project=${project} app=${app} compose=${composeName}`);
  let proj = await dokploy.findOrCreateProject(project);
  const envId = proj.environments?.[0]?.environmentId;
  if (!envId) throw new Error('No environment on project');

  let composeApp = proj.environments[0].compose?.find(c => c.name === composeName);
  if (!composeApp) {
    console.log(`📦 Deploying Convex template -> ${composeName}`);
    const tpl = await dokploy.deployComposeTemplate(envId, 'convex');
    if (tpl?.composeId) {
      await dokploy.updateCompose({ composeId: tpl.composeId, name: composeName });
      proj = await dokploy.findOrCreateProject(project);
      composeApp = proj.environments[0].compose.find(c => c.name === composeName);
    }
  } else {
    console.log(`📦 Compose '${composeName}' exists (composeId=${composeApp.composeId})`);
  }
  if (!composeApp) throw new Error('Convex compose service missing after deploy');

  // env: preserve INSTANCE_SECRET, set domains
  const current = await dokploy.getCompose(composeApp.composeId);
  const currentEnv = parseEnvString(current.env || '');
  const instanceSecret = currentEnv.INSTANCE_SECRET || crypto.randomBytes(32).toString('hex');

  let apiDomain, siteDomain, dashDomain;
  if (domain) {
    apiDomain = `api-${domain}`;
    siteDomain = `site-${domain}`;
    dashDomain = `dash-${domain}`;
    console.log(`🌐 Backend domains: ${apiDomain}, ${siteDomain}, ${dashDomain}`);

    const hostingerToken = process.env.HOSTINGER_API_TOKEN;
    if (hostingerToken) {
      for (const d of [apiDomain, siteDomain, dashDomain]) {
        await configureDns({ fullDomain: d, dokployApiUrl: apiUrl, hostingerToken });
      }
    }

    const backendDomains = [
      { host: apiDomain, port: 3210, serviceName: 'backend' },
      { host: siteDomain, port: 3211, serviceName: 'backend' },
      { host: dashDomain, port: 6791, serviceName: 'dashboard' },
    ];
    for (const d of backendDomains) {
      try {
        await dokploy.createDomain({ composeId: composeApp.composeId, https: true, certificateType: 'letsencrypt', ...d });
      } catch (e) { console.warn(`⚠️ ${d.host}: ${e.message}`); }
    }
    await dokploy.cleanupComposeDomains(composeApp.composeId, backendDomains.map(d => d.host));
  }

  const updates = { INSTANCE_SECRET: instanceSecret, INSTANCE_NAME: app };
  if (apiDomain) {
    updates.NEXT_PUBLIC_DEPLOYMENT_URL = `https://${apiDomain}`;
    updates.CONVEX_CLOUD_ORIGIN = `https://${apiDomain}`;
  }
  if (siteDomain) updates.CONVEX_SITE_ORIGIN = `https://${siteDomain}`;

  if (withAuth) {
    const keys = generateAuthKeys();
    updates.JWT_PRIVATE_KEY = keys.JWT_PRIVATE_KEY;
    updates.JWKS = keys.JWKS;
    console.log('🔐 Generated RS256 JWT_PRIVATE_KEY + JWKS');
  }

  await dokploy.updateComposeEnv(composeApp.composeId, updates);
  console.log('✅ Compose env synchronized');

  console.log('🚀 Triggering compose deployment...');
  await dokploy.deployCompose(composeApp.composeId);

  // Wait, then admin key + schema (if convex/schema.ts exists)
  const fs = require('fs');
  if (fs.existsSync(path.join(process.cwd(), 'convex/schema.ts'))) {
    console.log('⏳ Waiting 15s for backend to boot...');
    await new Promise(r => setTimeout(r, 15000));

    const latest = await dokploy.getCompose(composeApp.composeId);
    const runtimeName = latest.appName || composeApp.appName;
    const containerName = `${runtimeName}-backend-1`;

    try {
      const adminKey = generateAdminKey({ containerName });
      await dokploy.updateComposeEnv(composeApp.composeId, { CONVEX_ADMIN_KEY: adminKey });
      console.log(`🔑 admin key saved to compose env (truncated: ${adminKey.slice(0, 24)}...)`);

      if (apiDomain) {
        const { deploySchema } = require(path.resolve(__dirname, '../../../lib/convex'));
        try { deploySchema({ apiDomain, adminKey }); console.log('✅ Convex schema pushed'); }
        catch (e) { console.warn(`⚠️ schema push failed: ${e.message}`); }
      }

      if (withAuth) {
        try {
          await setBackendEnv({
            apiDomain, adminKey,
            changes: { JWT_PRIVATE_KEY: updates.JWT_PRIVATE_KEY, JWKS: updates.JWKS },
          });
          console.log('✅ JWT_PRIVATE_KEY + JWKS set via REST API');
        } catch (e) { console.warn(`⚠️ auth env set failed: ${e.message}`); }
      }
    } catch (e) {
      console.warn(`⚠️ admin-key generation failed: ${e.message}`);
    }
  }

  console.log('\n✅ sc-convex deploy done.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
