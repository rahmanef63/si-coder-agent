#!/usr/bin/env node
// deploy-convex.js — Idempotent self-hosted Convex compose deploy on Dokploy.
const path = require('path');
const crypto = require('crypto');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/dokploy'));
const { configureDns } = require(path.resolve(__dirname, '../../../lib/hostinger'));
const { parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));
const { generateAdminKey, generateAuthKeys, setBackendEnv } = require(path.resolve(__dirname, '../../../lib/convex'));
const { waitForValidTls } = require(path.resolve(__dirname, '../../../lib/tls'));

// Backend boot is polled, not slept-on: a cold image pull / slow host can take
// well over the old fixed 15s. Retry the admin-key generation (which runs a
// `docker exec` against the freshly-deployed container) until the container is
// up or the budget is exhausted.
const BACKEND_BOOT_ATTEMPTS = 12;
const BACKEND_BOOT_DELAY_MS = 5000;

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

// Per-service restart-policy injector — no YAML-parser dependency. Walks the
// compose file line by line, tracking the current service block (a 4-space
// `  <name>:` key under a 2-space `services:` block). Within each service block
// we note whether a `restart:` key already exists; if not, we insert
// `restart: unless-stopped` immediately after that service's `image:` line.
// Returns { composeFile, patched: [names], skipped: [names] }.
function patchRestartPolicy(composeFile) {
  const lines = composeFile.split('\n');
  const out = [];
  const patched = [];
  const skipped = [];

  // Indexes (in `lines`) of each service block's start + its image line, plus
  // whether it already declares a restart policy.
  const services = []; // { name, start, end, imageLine, hasRestart }
  let inServices = false;
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Top-level `services:` (no indentation).
    if (/^services:\s*$/.test(line)) { inServices = true; if (cur) cur.end = i; cur = null; continue; }
    // Any other top-level key ends the services section.
    if (/^[^\s#][^:]*:/.test(line)) { inServices = false; if (cur) { cur.end = i; cur = null; } continue; }
    if (!inServices) continue;
    // A service header: exactly 2-space indent, `  name:` with nothing after the colon.
    const svc = line.match(/^ {2}([A-Za-z0-9._-]+):\s*$/);
    if (svc) {
      if (cur) cur.end = i;
      cur = { name: svc[1], start: i, end: lines.length, imageLine: -1, hasRestart: false };
      services.push(cur);
      continue;
    }
    if (!cur) continue;
    // Keys nested under the service are indented >= 4 spaces.
    if (/^ {4}image:\s/.test(line) && cur.imageLine === -1) cur.imageLine = i;
    if (/^ {4}restart:\s/.test(line)) cur.hasRestart = true;
  }

  // Build the set of line indexes after which to inject the restart line.
  const injectAfter = new Map(); // imageLine -> indent string
  for (const s of services) {
    if (s.hasRestart) { skipped.push(s.name); continue; }
    if (s.imageLine === -1) continue; // no image line to anchor to; leave alone
    injectAfter.set(s.imageLine, '    ');
    patched.push(s.name);
  }

  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    if (injectAfter.has(i)) out.push(`${injectAfter.get(i)}restart: unless-stopped`);
  }

  return { composeFile: out.join('\n'), patched, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { project, app, domain } = args;
  const withAuth = !!args['with-auth-keys'];

  const USAGE = 'Usage: deploy-convex.js --project <PROJECT> --app <APP_NAME> [--domain root.tld] [--with-auth-keys]';
  // A bare flag (no value / followed by another --flag) yields `true` from
  // parseArgs. Reject those so e.g. `--domain` with no value can't become the
  // literal host `api-true`, or `--app` the compose name `true-db`.
  if (typeof project !== 'string' || typeof app !== 'string') {
    console.error(USAGE);
    process.exit(1);
  }
  if ('domain' in args && typeof domain !== 'string') {
    console.error('--domain requires a value (root.tld)\n' + USAGE);
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

  // The stock Dokploy 'convex' template ships WITHOUT a restart policy, so a
  // host reboot (live-restore off) leaves the backend permanently down while
  // Dokploy still reports the last deploy as 'done' (2026-06-07 incident:
  // tech.rahmanef.com data layer dark for 8 days). Patch it in idempotently.
  //
  // Done PER-SERVICE, not all-or-nothing: the old whole-file `!includes('restart:')`
  // guard meant a single service already carrying a restart policy blocked the
  // patch for EVERY other service. We instead inject `restart: unless-stopped`
  // after each service's `image:` line only when that service's block lacks a
  // restart key, and log exactly which services were patched vs. left alone.
  if (current.composeFile) {
    const patched = patchRestartPolicy(current.composeFile);
    if (patched.composeFile !== current.composeFile) {
      await dokploy.updateCompose({ composeId: composeApp.composeId, composeFile: patched.composeFile });
      console.log(`🔁 Added restart: unless-stopped to service(s): ${patched.patched.join(', ')}`);
    }
    if (patched.skipped.length) {
      console.log(`ℹ️ restart policy already present on service(s): ${patched.skipped.join(', ')}`);
    }
  }

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

    // Cert-gate BOTH downstream HTTPS pushes on a valid Let's Encrypt cert.
    // deploySchema() waits for TLS internally, but a schema-less first deploy
    // skips it and would race the not-yet-issued cert straight to the
    // --with-auth-keys REST call (setBackendEnv has no TLS wait). Hoisting the
    // wait here gates the schema push AND the auth-key push regardless of schema.
    await waitForValidTls(apiDomain);
  }

  const updates = { INSTANCE_SECRET: instanceSecret, INSTANCE_NAME: app };
  if (apiDomain) {
    updates.NEXT_PUBLIC_DEPLOYMENT_URL = `https://${apiDomain}`;
    updates.CONVEX_CLOUD_ORIGIN = `https://${apiDomain}`;
  }
  if (siteDomain) updates.CONVEX_SITE_ORIGIN = `https://${siteDomain}`;

  // Generated auth keys are pushed ONLY via the newline-safe JSON REST path
  // (setBackendEnv, below) — never through updateComposeEnv. The line-based
  // compose .env serializer cannot represent the multiline RS256 PEM; routing
  // JWT_PRIVATE_KEY through it silently truncates the key to its BEGIN line on
  // the next env merge (the PEM body lines are orphan, no-`=` lines that
  // parseEnvString drops). Keep them out of `updates` entirely.
  let authKeys = null;
  if (withAuth) {
    authKeys = generateAuthKeys();
    console.log('🔐 Generated RS256 JWT_PRIVATE_KEY + JWKS');
  }

  await dokploy.updateComposeEnv(composeApp.composeId, updates);
  console.log('✅ Compose env synchronized');

  console.log('🚀 Triggering compose deployment...');
  await dokploy.deployCompose(composeApp.composeId);

  // Admin key is generated once the compose deploy has been triggered — it is
  // logically independent of schema/auth, so it runs unconditionally. The
  // schema push is gated on convex/schema.ts existing; the auth env push only
  // needs adminKey + apiDomain (not a schema), so it runs whenever withAuth is
  // set and we have an apiDomain.
  const fs = require('fs');
  const failures = [];
  const hasSchema = fs.existsSync(path.join(process.cwd(), 'convex/schema.ts'));
  const maskSecret = (s = '') => (String(s).length <= 4 ? '****' : `len=${String(s).length} …${String(s).slice(-4)}`);
  {
    const latest = await dokploy.getCompose(composeApp.composeId);
    const runtimeName = latest.appName || composeApp.appName;
    const containerName = `${runtimeName}-backend-1`;

    // Poll instead of a single fixed sleep: the backend container may take far
    // longer than one delay to come up (cold image pull / slow host). Retry the
    // docker-exec-backed admin-key generation until it succeeds or the budget is
    // exhausted, surfacing only the last error.
    async function generateAdminKeyWithBoot() {
      let lastErr;
      for (let attempt = 1; attempt <= BACKEND_BOOT_ATTEMPTS; attempt++) {
        try {
          return generateAdminKey({ containerName });
        } catch (e) {
          lastErr = e;
          if (attempt < BACKEND_BOOT_ATTEMPTS) {
            console.log(`⏳ backend not ready (attempt ${attempt}/${BACKEND_BOOT_ATTEMPTS}): ${e.message}; retrying in ${BACKEND_BOOT_DELAY_MS / 1000}s...`);
            await new Promise(r => setTimeout(r, BACKEND_BOOT_DELAY_MS));
          }
        }
      }
      throw lastErr;
    }

    try {
      const adminKey = await generateAdminKeyWithBoot();
      await dokploy.updateComposeEnv(composeApp.composeId, { CONVEX_ADMIN_KEY: adminKey });
      console.log(`🔑 admin key saved to compose env (masked: ${maskSecret(adminKey)})`);

      if (hasSchema && apiDomain) {
        const { deploySchema } = require(path.resolve(__dirname, '../../../lib/convex'));
        try { await deploySchema({ apiDomain, adminKey }); console.log('✅ Convex schema pushed'); }
        catch (e) { failures.push(`schema push: ${e.message}`); console.error(`❌ schema push failed: ${e.message}`); }
      } else if (hasSchema && !apiDomain) {
        // Don't let a present schema be silently dropped: without --domain there
        // is no apiDomain to push it to, so warn loudly and tell the operator how
        // to push it (re-run with --domain root.tld). Non-fatal (not a failure)
        // so a domain-less deploy still succeeds.
        console.warn('⚠️ convex/schema.ts present but schema was NOT pushed — no --domain (apiDomain) supplied to push it to.');
        console.warn('   Re-run with --domain <root.tld> to push the schema, or push manually against api-<root.tld>.');
      } else if (!hasSchema) {
        console.log('ℹ️ convex/schema.ts absent — skipping schema push');
      }

      if (withAuth && apiDomain) {
        try {
          await setBackendEnv({
            apiDomain, adminKey,
            changes: { JWT_PRIVATE_KEY: authKeys.JWT_PRIVATE_KEY, JWKS: authKeys.JWKS },
          });
          console.log('✅ JWT_PRIVATE_KEY + JWKS set via REST API');
        } catch (e) { failures.push(`auth env set: ${e.message}`); console.error(`❌ auth env set failed: ${e.message}`); }
      } else if (withAuth && !apiDomain) {
        failures.push('auth env set: --with-auth-keys requires --domain (no apiDomain to push JWKS to)');
        console.error('❌ auth env set: --with-auth-keys requires --domain');
      }
    } catch (e) {
      failures.push(`admin-key generation: ${e.message}`);
      console.error(`❌ admin-key generation failed: ${e.message}`);
    }
  }

  if (failures.length) {
    console.error(`\n❌ sc-convex deploy FAILED — ${failures.length} critical step(s) did not complete:`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }

  console.log('\n✅ sc-convex deploy done.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
